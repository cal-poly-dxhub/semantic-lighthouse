export interface User {
  pk: `USER#${string}`;
  sk: string;
  username: string;
  email: string;
  snsTopicArn: string;
  snsTopicName: string;
  emailNotificationsEnabled: boolean;
  groupName: string;
  createdBy: string;
  updatedAt: string;
  deletedAt?: string;
}
