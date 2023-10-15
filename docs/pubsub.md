# Pub/Sub with Punt

Punt is built on top of Redis streams, a write-only data structure that allows for fast and efficient pub/sub implementation.

## Worker groups

By default, all worker processes subscribe to the default Punt channel. This is the same channel to which all messages are published when using Punt in the default job queue mode.

You don't necessarily need to create a new topic to subscribe to, until you have enough systems complexity to required it. You can still publish messages to the default topic, and the same workers that process background jobs will also receive and process pub/sub events. This is the simplest way to get started with Punt pub/sub.

```js
npx punt worker --group my-group
```

Grouping creates cluster of workers. Each message published to a topic will be received by one worker in each group. This might sound complicated but it's actually quite simple.

Imagine you have been using Punt in the default job queue mode, and you have a few worker processes running. Each worker process is subscribed to the default topic, and it's part of the default group.

Now you want to add a second service to your system, and you want that service receiving and processing a few events published by your first service. This is easily accomplished by splitting the workers into two groups, one for each service. You can then publish messages to the default topic, and each message will be received by one worker from each service.

Let's illustrate this with an example.

Your main backend service is already punting a `UserSignedUp` event every time a new user signs up. Now we want to create a new notification service that will be responsible for sending welcome emails every time a user signs up.

If the main backend service was your first service, you'll likely have been running your workers like this:

```
npx punt worker
```

Now you want to start your workers for the main backend service like this:

```
npx punt worker --group main
```

And you want to start your workers for the notification service like this:

```
npx punt worker --group notifications
```

Now, when the main service does

```js
await punt('UserSignedUp', { userId: 1 })
```

the `UserSignedUp` event will be received and processed by one worker from the main service and one worker from the notification service.

Note: this is why we recommend naming jobs after **events** rather than **commands**. It doesn't make a difference in the way Punt works, but it's a change of mindset that makes it easier to reason about systems when we start spinning up new services that will consume those events.

For small evolving systems, you can start with a single group and a single topic, and then split into multiple groups and topics.

## Topics

Add documentation about topics.

## Job naming conventions

In punts perspective, it doesn't matter which names you give to your jobs. You can `punt('UserSignedUp')`, or `punt('createUser')`, or `punt('YoMama')`. As long as you have a `worker` call that defines a handler for that job, such as `worker('UserSignedUp', () => doWork())`, it will work.

That said, using a naming convention helps you reason about your system. We recommend using the following naming conventions:

- For **Events** use entity + past verbs in PascalCase, such as `UserSignedUp`, `OrderCreated`, `PaymentReceived`.
- For **Commands** use imperative verbs in camelCase, such as `createUser`, `sendEmailNotification`, `processPayment`.

## Events vs commands

There are two distinct types of jobs out there: events and commands. The simplest way to explain the difference is that events are things that have already happened, and commands are things that should happen.

For example, when a user signs up, you want to send a welcome email. It's likely you have a backend endpoint that handles signups. Since sending an email is something best done in the background (you don't want to block the user while the email is being sent), so using a background job is ideal here.

There are two ways to approach this with background jobs.

First, you can `punt('sendWelcomeEmail', {id: user.id})` after the user record is persisted. This will be your backend endpoint _telling_ a worker to send the email, therefore it's a command.

Second, you can `punt('UserSignedUp', {id: user.id})` after the user record is persisted. In this case, your endpoint is not asking any workers to do anything. It is simply broadcasting the fact that a user has signed up. This is an event.

The difference is subtle, but an important one. There in inherently more coupling in the first approach, since the backend endpoint is telling the worker what to do. In the second approach, the backend endpoint is simply broadcasting an event. It's like saying "Hey everyone, a user just signed up! Do what you must."
