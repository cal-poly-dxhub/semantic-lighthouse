import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface CustomEmailResourcesProps {
  userPool: cdk.aws_cognito.UserPool;
  frontendDistribution: cdk.aws_cloudfront.IDistribution;
}

export class CustomEmailResources extends Construct {
  constructor(scope: Construct, id: string, props: CustomEmailResourcesProps) {
    super(scope, id);

    const newUserMessageLambda = new cdk.aws_lambda.Function(
      this,
      "CustomMessageLambda",
      {
        description: "lambda function for custom email messages",
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/auth"),
        handler: "custom-message.handler",
        environment: {
          FRONTEND_URL: `https://${props.frontendDistribution.distributionDomainName}`,
        },
        logGroup: new cdk.aws_logs.LogGroup(
          this,
          "CustomMessageLambdaLogGroup",
          {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }
        ),
      }
    );

    // trigger when admin creates a user
    props.userPool.addTrigger(
      cdk.aws_cognito.UserPoolOperation.CUSTOM_MESSAGE,
      newUserMessageLambda
    );

    // trigger when user signs up
    props.userPool.addTrigger(
      cdk.aws_cognito.UserPoolOperation.PRE_SIGN_UP,
      newUserMessageLambda
    );
  }
}
