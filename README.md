# Punt for Node.js

Punt is a developer friendly queue for processing background jobs.

> As an idiom, “to punt” means to defer action, or to pass responsibility off to someone else.
>
> _- Probably the least trustworthy dictionary ever_

## Installation

### 1. Setting up your development environment

Punt requires Redis to run. [Here's]() a guide on how to install Redis on the common development systems.

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

- `-t, --ts`: Typescript mode. This option enables the Typescript loader, allowing you to run workers without a transpilation step. This is quite useful in development mode. This option will be automatically applied if your entrypoint is a `.ts` file.

> 💡 **Important note**
>
> Punt has a peer dependency on `ts-node` for running in Typescript mode. If you're using Typescript, it's likely you have it installed already. If you don't, install it by running
>
> ```
> npm install --save-dev ts-node
> ```

### Getting Help

If you have a question, please create a topic in [Discussions](https://github.com/puntWork/node/discussions).

If you believe you found a bug, please open [an Issue](https://github.com/puntWork/node/issues).
