import axios from 'axios';
import Debug from 'debug';
import { Battery } from './battery.js';
import { login } from 'teslajs/src/auth';

const debug = Debug('tesla:debug');

const TESLA_USER_AGENT = 'TeslaApp/3.4.4-350/fad4a582e/android/8.1.0';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 8.1.0; Pixel XL Build/OPM4.171019.021.D1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/68.0.3440.91 Mobile Safari/537.36';
const BASE_URL = 'https://owner-api.teslamotors.com';

export class Tesla {
  constructor () {
    // Create a Tesla API Client
    this.client = axios.create({ baseURL: BASE_URL });
    this.client.defaults.headers.common['x-tesla-user-agent'] = TESLA_USER_AGENT;
    this.client.defaults.headers.common['user-agent'] = USER_AGENT;
    this.client.interceptors.response.use(response => {
      debug(response.data);
      return response;
    });
  }

  login ({ username, password, mfaPassCode }) {
    return new Promise((resolve, reject) => {
      login({ identity: username, credential: password, mfaPassCode }, (error, response, body) => {
        if (error !== null) {
          return reject(error);
        }

        resolve({ authToken: body.access_token, expires: body.created_at + body.expires_in, refreshToken: body.refresh_token });
      });
    });
  }

  auth (token) {
    this.client.interceptors.request.use(request => {
      if (request.url !== 'oauth/token') {
        request.headers.common.Authorization = `Bearer ${token}`;
      }
      return request;
    });
  }

  refresh (token) {
    return this.client.post('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: token
    }).then(({ data }) => {
      return { authToken: data.access_token, expires: data.created_at + data.expires_in, refreshToken: data.refresh_token };
    });
  }

  async getBatteryInfo () {
    debug('Getting products on this Tesla account');
    const products = await this.client
      .get('/api/1/products').then(({ data }) => {
        if (!Array.isArray(data.response)) {
          throw new Error('Product response does not contain array of energy products');
        }
        return data.response;
      });

    const battery = products.find(product => product.resource_type === 'battery');

    if (typeof battery === 'undefined') {
      throw new Error('No battery found in product list');
    }

    debug('Getting battery info');
    return this.client
      .get(`/api/1/energy_sites/${battery.energy_site_id}/site_info`)
      .then(({ data }) => new Battery(battery.energy_site_id, data.response));
  }

  setBatteryReserve (siteId, reserve) {
    debug(`Setting reserve to ${reserve}%`);
    return this.client
      .post(`/api/1/energy_sites/${siteId}/backup`, { backup_reserve_percent: reserve })
      .then(({ data }) => data);
  }
}
