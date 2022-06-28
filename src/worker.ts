import main, { startUp } from './lib/worker'

startUp().then(() => main())
