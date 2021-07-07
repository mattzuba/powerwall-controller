import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import Debug from 'debug';

const debug = Debug('dynamo:debug');
const dynamoEndpoint = process.env?.AWS_SAM_LOCAL ? 'http://dynamodb-local:8000' : null;

export class Dynamo {
  constructor () {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: dynamoEndpoint }));
  }

  putSetting (Key, Value) {
    debug(`Putting '${Key}' with ${JSON.stringify(Value)}`);
    return this.client
      .send(new PutCommand({ TableName: 'Settings', Item: { Key, Value } }))
      .then(response => {
        debug(`PutCommand Response from DynamoDB: ${JSON.stringify(response)}`);
        return response;
      });
  }

  getSetting (Key) {
    return this.client
      .send(new GetCommand({ TableName: 'Settings', Key: { Key } }))
      .then(response => {
        debug(`GetCommand Response from DynamoDB: ${JSON.stringify(response)}`);
        return response.Item?.Value;
      });
  }
}
