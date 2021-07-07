'use strict';

import { DateTime, Interval } from 'luxon';
import Debug from 'debug';
import { Dynamo } from './lib/dynamo.js';
import { Sns } from './lib/sns.js';
import { Tesla } from './lib/tesla.js';
import { to } from './lib/to.js';

const DEFAULT_PEAK_RESERVE = 20;
const MAX_RESERVE = 100;

const dynamo = new Dynamo();
const tesla = new Tesla();
const sns = new Sns();

const info = Debug('app:info');
const debug = Debug('app:debug');

export const login = async ({ body }) => {
  debug(`Request body: ${body}`);
  const { username, password, mfaPassCode } = JSON.parse(body);

  let [err, { refreshToken, authToken, expires }] = await to(tesla.login({ username, password, mfaPassCode }));
  if (err) throw new Error(`Error getting a refresh token, check your username, password or MFA token and try again: ${err.toString()}`);

  await Promise.all([
    dynamo.putSetting('refreshToken', refreshToken),
    dynamo.putSetting('authToken', authToken),
    dynamo.putSetting('tokenExpires', expires)
  ]);

  return {
    statusCode: 204,
    body: ""
  }
};

export const settings = async ({ body, pathParameters: { setting }, requestContext: { http: { method: httpMethod }} }) => {
  debug(`Request body: ${body}; Setting: ${setting}; Method: ${httpMethod}`);

  if (httpMethod.toLowerCase() === 'get') {
    return getSetting(setting);
  }

  if (httpMethod.toLowerCase() !== 'post') {
    throw new Error(`Method not supported for settings function: ${httpMethod}`);
  }

  return updateSetting(setting, JSON.parse(body));
}

async function getSetting(setting) {
  let response;

  switch (setting) {
    case 'notify':
      response = await sns.getSubscriptions();
      break;

    case 'holiday':
      response = await dynamo.getSetting('holidays') ?? [];
      break;

    case 'reserve':
      response = await dynamo.getSetting('peakReserve') ?? DEFAULT_PEAK_RESERVE
      break;

    default:
      response = await Promise.all([
          sns.getSubscriptions(),
          dynamo.getSetting('holidays'),
          dynamo.getSetting('peakReserve')
        ]).then(([ notify, holiday, reserve ]) => ({ notify, holiday: holiday ?? [], reserve: reserve ?? DEFAULT_PEAK_RESERVE }));
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response)
  }
}

async function updateSetting(setting, data) {
  switch (setting) {
    case 'notify':
      let { email } = data;
      await sns.subscribe(email);
      break;

    case 'holiday':
      let { holiday, remove } = data;
      let currentHolidays = await dynamo.getSetting('holidays') ?? [];

      // Reformat our input into a known/trusted format
      holiday = !Array.isArray(holiday) ? new Array(holiday) : holiday;
      holiday = holiday.map(date => DateTime.fromSQL(date).toLocaleString());

      currentHolidays = remove === true
        ? currentHolidays.filter(day => !holiday.includes(day)) // Filter out anything that's already there
        : [...new Set([...currentHolidays, ...holiday])]; // Or add the new ones.  Use a set to get unique entries

      await dynamo.putSetting('holidays', currentHolidays);
      break;

    case 'reserve':
      // This could be called from either API or during deploy, handle both
      let { peakReserve } = data;

      // Make sure it's been 5 and 100%
      peakReserve = Math.max(Math.min(100, peakReserve ?? 5), 5);

      // Set the value in DynamoDB
      await dynamo.putSetting('peakReserve', peakReserve);
      break;

    default:
      throw new Error(`Unsupported setting: ${setting}`);
  }

  return {
    statusCode: 204,
    body: ""
  }
}

export const adjuster = async () => {
  let err, battery, peakReserve, holidays;

  // Make sure authentication with the Tesla API is all set
  [err] = await to(prepareTeslaClient());
  if (err) return adjustError('Error configuring Tesla API Client', err);

  // Get the on-peak hours and see if we should be in on-peak mode
  [err, battery] = await to(tesla.getBatteryInfo());
  if (err) return adjustError('Error getting Tesla Powerwall Information', err);

  // Make sure we're in the right mode first of all
  if (!battery.isTou()) return adjustError('Error adjusting Tesla Powerwall reserve', 'The Powerwall is not in TOU mode.');

  [err, peakReserve] = await to(dynamo.getSetting('peakReserve').then(reserve => reserve ?? DEFAULT_PEAK_RESERVE));
  if (err) return adjustError('Error getting configured reserve', err);

  [err, holidays] = await to(dynamo.getSetting('holidays').then(holidays => Array.isArray(holidays) ? holidays : []));
  if (err) return adjustError('Error getting configured holidays', err);

  const desiredReserve = !isHoliday(holidays) && inPeakTime(battery.peakSchedule()) ? peakReserve : MAX_RESERVE;

  if (battery.reserveLevel() === desiredReserve) {
    info(`Battery reserve level (${battery.reserveLevel()}%) matches desired reserve (${desiredReserve}%); not changing`);
    return;
  }

  info(`Reserve level (${battery.reserveLevel()}%) does not match desired reserve (${desiredReserve}%); updating`);
  [err] = await to(tesla.setBatteryReserve(battery.siteId(), desiredReserve));
  if (err) return adjustError('Error adjusting Tesla Powerwall reserve', err);
};

/**
 * @param holidays
 * @returns {boolean}
 */
function isHoliday(holidays) {
  return holidays.includes(DateTime.now().toLocaleString());
}

/**
 * @param peakSchedule
 * @returns {boolean}
 */
function inPeakTime(peakSchedule) {
  const now = DateTime.now();

  for (const block of peakSchedule) {
    // mod 7 because now.weekday == 7 == sunday, but powerwall sunday == 0
    if (!block.week_days.includes(now.weekday % 7)) {
      debug('Current week day is not in this peak period');
      continue;
    }

    // Create a peak interval that begins one hour prior to actual start (buffer to ensure it changes)
    // to the end of peak time
    const peakInterval = Interval.fromDateTimes(
      now.startOf('day').plus({ seconds: block.start_seconds - 3600 }),
      now.startOf('day').plus({ seconds: block.end_seconds })
    );

    debug(`Peak interval: ${peakInterval.toString()}`);

    // If our current time is within the interval, it's in peak time
    if (peakInterval.contains(now)) {
      debug(`Peak interval matches: ${now.toString()}`);
      return true;
    }
  }

  return false;
}

function adjustError(subject, error) {
  const message = `An error was encountered setting the battery reserve:\n\n${error.toString()}`;
  return sns.notify(subject, message).then(() => null);
}

/**
 * Uses auth and/or refresh tokens to prepare to work against the tesla api
 * @returns {Promise<void>}
 */
async function prepareTeslaClient () {
  const now = DateTime.now();
  let refreshToken, authToken, expires, err;

  [err, [refreshToken, authToken, expires]] = await to(Promise.all([
    dynamo.getSetting('refreshToken'),
    dynamo.getSetting('authToken'),
    dynamo.getSetting('tokenExpires')
  ]));
  if (err) throw new Error(`Error getting tokens from DynamoDB: ${err.toString()}`);

  // If we have a authToken and it's not expired, use it
  if (typeof authToken === 'string' && DateTime.fromSeconds(expires) > now) {
    return tesla.auth(authToken);
  }

  info('No auth token or it is expired, getting new one with refresh token');

  // Make sure we have a refresh token
  if (typeof refreshToken === 'undefined') {
    throw new Error('Unable to get new auth token, no refresh token');
  }

  [err, { refreshToken, authToken, expires }] = await to(tesla.refresh(refreshToken));
  if (err) throw new Error(`Error refreshing token from Tesla: ${err.toString()}`);

  await Promise.all([
    dynamo.putSetting('refreshToken', refreshToken),
    dynamo.putSetting('authToken', authToken),
    dynamo.putSetting('tokenExpires', expires)
  ]);

  tesla.auth(authToken);
}
