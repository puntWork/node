# Punt for Node.js

Punt is a developer friendly queue for processing background jobs.

> As an idiom, “to punt” means to defer action, or to pass responsibility off to someone else.
>
> _- Probably the least trustworthy dictionary ever_

## Installation

### 1. Setting up your development environment

Punt requires Redis to run. [Here's](https://redis.io/docs/getting-started/installation/) a guide on how to install Redis on the common development systems.

### 2. Install Punt

```
$ npm install @punt/node
```

or

```
$ yarn add @punt/node
```

## Start quickly

```js
// index.js

import punt, { worker } from '@punt/node'

worker('sayHello', async ({ name }) => {
  console.log('Hello,', name)
})

punt('sayHello', { name: 'Punt' })
```

```sh
$ npx punt worker index.js
# => Hello, Punt
```

## Command Line Interface

`punt` is Punt's CLI tool to start worker processes. You can run it with `npx punt`. The syntax is

```
npx punt worker [entrypoint] <options>
```

- `[entrypoint]` is a Javascript or Typescript file that loads all project files with `worker` function calls. This argument is **required**.
- `<options>` are runtime options. See below.

### CLI options

- `-t, --ts`: Typescript mode. This option enables the Typescript loader, allowing you to run workers without a transpilation step (useful in development mode). This option will be automatically applied if your entrypoint is a `.ts` file.

> 💡 **Important note**
>
> Punt has a peer dependency on `ts-node` for running in Typescript mode. If you're using Typescript, it's likely you have it installed already. If you don't, install it by running
>
> ```
> npm install --save-dev ts-node
> ```

- `-v, --verbose`: Verbose output. This option enables debug logs.

### Verbose

To debug your workers, you can run them in verbose mode. This will print out the logs of your workers to the console.

You can either start the worker with the `DEBUG` environment variable set to `punt:*` or with the `--verbose` (or `-v`) option:

```
DEBUG=punt:* npx punt worker entrypoint.js
```

or

```
npx punt worker entrypoint.js -v
```

## Connecting to Redis

Punt recommends setting the `REDIS_URL` environment variable with valid Redis connection string. If you don't set it, Punt will default to `redis://localhost:6379`.

You can use a `rediss://` connection string to connect to a Redis server over TLS.

### Connecting to Heroku Redis

Heroku Redis uses an encrypted connection with a self-signed certificate. To connect to Heroku Redis, you need to set the `REDIS_TLS_REJECT_UNAUTHORIZED` environment variable to `0`.

Alternatively, you can set the `redisOptions` entry in your Punt config file `punt.config.js` to

```js
// punt.config.js

module.exports = {
  // ... other configuration
  redisOptions: {
    tls: {
      rejectUnauthorized: false,
    },
  },
}
```

The config file should not interfere with your development environment, as Punt will ignore the `tls` entry for non-encrypted connections (`redis://`).

## Getting Help

If you have a question, please create a topic in [Discussions](https://github.com/puntWork/node/discussions).

If you believe you found a bug, please open [an Issue](https://github.com/puntWork/node/issues).
