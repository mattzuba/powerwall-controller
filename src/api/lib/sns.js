import {
  SNSClient,
  SubscribeCommand,
  PublishCommand,
  ListSubscriptionsByTopicCommand, UnsubscribeCommand
} from '@aws-sdk/client-sns';

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

  unsubscribe (SubscriptionArn) {
    return this.client.send(new UnsubscribeCommand({
      SubscriptionArn
    }));
  }

  getSubscriptions () {
    return this.client.send(new ListSubscriptionsByTopicCommand({
      TopicArn: SNS_TOPIC
    })).then(({ Subscriptions }) => {
      return Subscriptions.map(({ Endpoint, SubscriptionArn }) => {
        return { Endpoint, SubscriptionArn };
      });
    });
  }

  notify (subject, message) {
    return this.client.send(new PublishCommand({
      TopicArn: SNS_TOPIC,
      Subject: subject,
      Message: message
    }));
  }
}
