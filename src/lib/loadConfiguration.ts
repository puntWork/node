import path from 'path'
import { PuntConfig } from '../types'

/**
 * Loads the Punt configuration module from `punt.config.js`.
 *
 * @returns The configuration from the config file or an empty object if no config file is found.
 */

export const loadConfiguration = (): PuntConfig => {
  const projectRoot = process.cwd()
  let configFromFile: PuntConfig = {}

  try {
    configFromFile = require(path.join(projectRoot, 'punt.config.js'))
  } catch (error: any) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error
    }
  }

  return configFromFile
}
