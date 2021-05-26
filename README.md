## Introduction

I wrote this AWS Lambda-based script to manage my Powerwalls with a bit more fine-grained control than what the Tesla app offers.  Because of my power company's higher export rate that I've locked into for 10 years (10.45c/kWh), and the low cost of off-peak electricity on my current plan (5.23c/kWh), I can leverage this arbitrage to use my system to my cost-advantage.  I need to feed as much electricity to the grid as I can (minimizing power consumption during the day) and use as much from the grid as I can (maximizing power consumption during the night).

I accept the fact that this is not the most environmentally friendly option; one with solar + storage should probably aim to be as self-reliant as possible.  But I'm tired of the monopoly of the power companies with their less than desirable renewable energy stance when they don't control it, so I'm leveraging this loophole to recoup my investment sooner.

## Tesla Shortcomings

Tesla's app doesn't have a mode that suits my needs - namely - only use the Powerwall during peak times.  It does have some advanced time-of-use (TOU) settings (which this script actually utilizes), but they don't go far enough.  Using Tesla's out-of-the-box TOU control, my Powerwalls still get used overnight, on weekends and on power company holidays.

## Improvements

This script handles all the issues above by leveraging the Peak TOU settings from the Tesla app to set the battery reserve to a lower level only during peak periods, and then to 100% during all the times above so that the Powerwalls are not used.

## Setup

### Tesla

First you'll want to head over to your Tesla app and configure Advanced Time-based control, editing the Price Schedule to properly reflect your peak period.  This script currently uses Tesla's peak period setup and therefore only works with a single Peak period.

### AWS

If you don't already have an Amazon Web Services cloud account, sign-up for one.  This script will run free for the first year, and be pennies (if that) per month afterwards.

### Local Development

If you want to toy with this locally, you'll need to install the following:

* Docker
* AWS CLI
* AWS SAM CLI
* Node v14
* Any other associated requirements for the tools above

## Deployment

This script uses Github actions to deploy to AWS, the only thing you need to do is log into the AWS Console and generate an access key and secret key and store those in your Secrets in Github (see .github/workflows/deploy.yml for key names).

You'll also want to update the samconfig.toml and change the parameter overrides as necessary.  Once the script successfully deploys, you can begin remote configuration.  View the output from the deploy in Github actions to see the AWS API Gateway endpoint in the `npm run deploy` step.

## Configuration

Use a tool like httpie (used below) or cURL to remotely call the login endpoint.

```bash
$ http post http://endpoint..execute-api.us-east-1.amazonaws.com/login username=AzureDiamond@gmail.com password=hunter2 mfaPassCode=000000
```

If all goes well, you should see output like the following:

```bash
HTTP/1.0 200 OK
Content-Length: 16
Content-Type: application/json
Date: Tue, 25 May 2021 00:17:24 GMT
Server: Werkzeug/1.0.1 Python/3.9.0

Login successful
```

At this point, everything will start working.  If you'd like to configure/add holidays where the entire day is off-peak, you can add them like so:

```bash
http post https://endpoint.execute-api.us-east-1.amazonaws.com/holiday holiday:='["2021-07-04", "2021-09-06", "2021-11-11", "2021-11-25", "2021-12-25"]'
```

The output will be a list of all holidays currently in the database:

```bash
HTTP/1.1 200 OK
Apigw-Requestid: f3B6ZhMRoAMEVuQ=
Connection: keep-alive
Content-Length: 74
Content-Type: application/json
Date: Tue, 25 May 2021 00:50:36 GMT

[
    "5/31/2021",
    "7/4/2021",
    "9/6/2021",
    "11/11/2021",
    "11/25/2021",
    "12/25/2021"
]
```

If you accidentally add a holiday you want to remove, it's easy as well:

```bash
http post https://endpoint.execute-api.us-east-1.amazonaws.com/holiday holiday:='["2021-12-25"]' remove:=true
```

## Todo

* (Maybe) support more than one peak period