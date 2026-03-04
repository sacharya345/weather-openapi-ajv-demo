const config = require('./config');
const logger = require('./logger');
const ExpressServer = require('./expressServer');

let expressServer;

const launchServer = async () => {
  try {
    expressServer = new ExpressServer(config.URL_PORT, config.OPENAPI_YAML);
    expressServer.launch();
    logger.info('Express server running');
  } catch (error) {
    logger.error('Express Server failure', error.message);
    if (expressServer) {
      await expressServer.close();
    }
    process.exit(1);
  }
};

launchServer().catch((e) => logger.error(e));