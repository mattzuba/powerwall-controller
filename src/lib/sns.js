import { SNSClient, SubscribeCommand, PublishCommand } from '@aws-sdk/client-sns';

const SNS_TOPIC = process.env.SNS_TOPIC;

export class Sns {
  constructor () {
    this.client = new SNSClient({ region: 'us-east-1' });
  }

  subscribe (email) {
    return this.client.send(new SubscribeCommand({
      TopicArn: SNS_TOPIC,
      Protocol: 'email',
      Endpoint: email
    }));
  }

  notify (subject, message) {
    return this.client.send(new PublishCommand({
      TopicArn: SNS_TOPIC,
      Subject: subject,
      Message: message
    }));
  }
}
