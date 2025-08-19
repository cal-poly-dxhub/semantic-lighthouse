# DynamoDB Schema Documentation

## Table Structure

The application uses a single DynamoDB table with composite keys and different item types.

### Primary Keys

- **Partition Key (pk)**: STRING
- **Sort Key (sk)**: STRING (createdAt)

### Item Types

## 1. Meeting Items

**Access Pattern**: Query by `pk = "MEETING#<meetingId>"` and `sk = <createdAt>`

### Schema

```
{
  pk: STRING ("MEETING#<meetingId>"),
  sk: STRING (createdAt),
  userId: STRING,
  meetingTitle: STRING,
  meetingDate: STRING,
  meetingDescription: STRING,
  videoVisibility: STRING ("public" | "private"),
  status: STRING ("uploading" | "preprocessing" | "processing" | "complete" | "deleted"),
  videoS3Key: STRING,
  agendaS3Key: STRING,
  updatedAt: STRING,
  deletedAt: STRING (optional, when status = "deleted")
}
```

## 2. User Items

**Access Pattern**: Query by `pk = "USER#<userId>"` and `sk = <createdAt>`

### Schema

```
{
  pk: STRING ("USER#<username>")
  sk: STRING (createdAt),
  email: STRING,
  snsTopicArn: STRING,
  snsTopicName: STRING,
  emailNotificationsEnabled: BOOLEAN,
  groupName: STRING,
  createdBy: STRING (creator's username),
  updatedAt: STRING,
  deletedAt: STRING (optional)
}
```
