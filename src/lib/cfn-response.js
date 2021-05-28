// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Modified by Matt Zuba <matt.zuba@gmail.com>

import https from 'https';
import { URL } from 'url';
import Debug from 'debug';

const debug = Debug('cfn-response:debug');

export const SUCCESS = 'SUCCESS';
export const FAILED = 'FAILED';

export const cfnResponse = function (event, context, responseStatus, responseData, physicalResourceId, noEcho) {
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: noEcho || false,
    Data: responseData
  });

  debug(`Response body:\n${responseBody}`);

  const parsedUrl = new URL(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  };

  return new Promise((resolve, reject) => {
    debug('Starting a new Promise');
    const req = https.request(options, res => {
      debug('Receiving response from endpoint');
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode <= 299) {
          debug(`Valid response received: ${JSON.stringify(res)}`);
          resolve({ statusCode: res.statusCode, message: res.statusMessage, headers: res.headers });
        } else {
          debug(`Failure: ${JSON.stringify(res)}`);
          reject(new Error(`Request failed. status: ${res.statusCode}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    debug('Writing response body to endpoint');
    req.write(responseBody);
    req.end();
  });
};
