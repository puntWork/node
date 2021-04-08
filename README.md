# Punt for Node.js

Punt is a developer friendly queue for processing background jobs.

> As an idiom, “to punt” means to defer action, or to pass responsibility off to someone else.

_- Probably the least trustworthy dictionary ever_

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
import punt, { worker } from '@punt/node'

worker('sayHello', async ({ name }) => {
  console.log('Hello,', name)
})

punt('sayHello', { name: 'Punt' })

// => Hello, Punt
```
