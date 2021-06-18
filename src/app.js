'use strict';

import { DateTime, Interval } from 'luxon';
import Debug from 'debug';
import { Dynamo } from './lib/dynamo.js';
import { Sns } from './lib/sns.js';
import { Tesla } from './lib/tesla.js';
import { to } from './lib/to.js';

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
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: "Login successful"
  }
};

export const notify = async ({ body }) => {
  debug(`Request body: ${body}`);
  try {
    let { email } = JSON.parse(body);
    await sns.subscribe(email);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: `Subscribe started, please check your email at ${email} to confirm the subscription`
    }
  } catch (e) {
    throw new Error(`Error subscribing to SNS topic: ${e.toString()}`);
  }
}

export const holiday = async ({ body }) => {
  debug(`Request body: ${body}`);
  let currentHolidays;
  try {
    let { holiday, remove } = JSON.parse(body);
    currentHolidays = await dynamo.getSetting('holidays') ?? [];

    // Reformat our input into a known/trusted format
    holiday = !Array.isArray(holiday) ? new Array(holiday) : holiday;
    holiday = holiday.map(date => DateTime.fromSQL(date).toLocaleString());

    currentHolidays = remove === true
      ? currentHolidays.filter(day => !holiday.includes(day)) // Filter out anything that's already there
      : [...new Set([...currentHolidays, ...holiday])]; // Or add the new ones.  Use a set to get unique entries

    debug(`Setting holidays: ${JSON.stringify(currentHolidays)}`);

    await dynamo.putSetting('holidays', currentHolidays);
  } catch (e) {
    throw new Error(`Error adjusting holidays: ${e.toString()}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentHolidays)
  };
};

export const adjuster = async () => {
  let err, battery;
  // Make sure authentication with the Tesla API is all set
  [err] = await to(prepareTeslaClient());
  if (err) {
    const message = `There was a problem configuring the tesla api client.  Here was the error encountered:\n\n${err.toString()}`;
    await sns.notify('Error adjusting Tesla Battery Reserve', message);
    return;
  }

    // Get the on-oeak hours and see if we should be in on-peak mode
  [err, battery] = await to(tesla.getBatteryInfo());
  if (err) {
    const message = `There was a problem getting battery information.  Here was the error encountered:\n\n${e.toString()}`;
    await sns.notify('Error adjusting Tesla Battery Reserve', message);
    return;
  }

  try {
    // Make sure we're in the right mode first of all
    if (!battery.isTou()) {
      throw new Error('Battery is not in TOU mode, not setting backup reserve.');
    }

    const peakReserve = await dynamo.getSetting('peakReserve') ?? 20;

    const desiredReserve = !await isHoliday() && inPeakTime(battery.peakSchedule()) ? peakReserve : MAX_RESERVE;

    if (battery.reserveLevel() === desiredReserve) {
      info(`Battery reserve level (${battery.reserveLevel()}%) matches desired reserve (${desiredReserve}%); not changing`);
      return;
    }

    info(`Reserve level (${battery.reserveLevel()}%) does not match desired reserve (${desiredReserve}%); updating`);
    await tesla.setBatteryReserve(battery.siteId(), desiredReserve);
  } catch (e) {
    const message = `There was a problem setting the battery reserve.  Here was the error encountered:\n\n${e.toString()}`;
    await sns.notify('Error adjusting Tesla Battery Reserve', message);
  }
};

export const reserve = async ({ body }) => {
  debug(`Request body: ${body}`);
  try {
    // This could be called from either API or during deploy, handle both
    let { peakReserve } = JSON.parse(body);

    // Make sure it's been 5 and 100%
    peakReserve = Math.max(Math.min(100, peakReserve ?? 5), 5);

    // Set the value in DynamoDB
    await dynamo.putSetting('peakReserve', peakReserve);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: `Peak reserve set to ${peakReserve}`
    };
  } catch (e) {
    throw new Error(`Error adjusting holidays: ${e.toString()}`);
  }
}

/**
 * @returns {Promise<*>}
 */
async function isHoliday() {
  return dynamo.getSetting('holidays')
    .then(holidays => Array.isArray(holidays) && holidays.includes(DateTime.now().toLocaleString()));
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

    // If our current time is within the interval, it's in peak time
    if (peakInterval.contains(now)) {
      debug(`Peak interval matches: ${now.toString()} is between ${peakInterval.toString()}`);
      return true;
    }
  }

  return false;
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
