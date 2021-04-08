import punt, { worker } from './lib/punt'

worker('sayHello', async (message: any) => {
  console.log('Hello,', message.name)
})

punt('sayHello', { name: 'Punt' })
