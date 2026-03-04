const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const http = require('http');
const fs = require('fs');
const path = require('path');
const swaggerUI = require('swagger-ui-express');
const jsYaml = require('js-yaml');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const OpenApiValidator = require('express-openapi-validator');
const logger = require('./logger');
const config = require('./config');

function loadOpenApiSpec(openApiYamlPath) {
  const raw = fs.readFileSync(openApiYamlPath, 'utf8');
  return jsYaml.safeLoad(raw);
}

function getWeatherSchema(spec) {
  const schema = spec?.components?.schemas?.Weather;
  if (!schema) throw new Error('Weather schema not found');
  return schema;
}

class ExpressServer {
  constructor(port, openApiYaml) {
    this.port = port;
    this.app = express();
    this.openApiPath = openApiYaml;
    try {
      this.schema = jsYaml.safeLoad(fs.readFileSync(openApiYaml));
    } catch (e) {
      logger.error('failed to start Express Server', e.message);
    }
    this.setupMiddleware();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: '14MB' }));
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cookieParser());

    // --- Load schema from OpenAPI (contract-first) ---
    const spec = loadOpenApiSpec(this.openApiPath);
    const weatherSchemaFromSpec = getWeatherSchema(spec);

    // Clone schema so AJV-only changes do not mutate the OpenAPI spec in memory
    const weatherSchema = JSON.parse(JSON.stringify(weatherSchemaFromSpec));

    // --- AJV Setup ---
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    // OPTIONAL ADVANCED: Custom keyword realisticTemperature (-90..60)
    ajv.addKeyword({
      keyword: 'realisticTemperature',
      type: 'number',
      errors: true,
      validate: function realisticTemperature(schemaValue, data) {
        const ok = data >= -90 && data <= 60;
        if (!ok) {
          realisticTemperature.errors = [
            {
              keyword: 'realisticTemperature',
              message: 'temperature must be between -90 and 60',
              params: { min: -90, max: 60 },
            },
          ];
        }
        return ok;
      },
    });

    // Apply keyword in AJV schema (NOT in openapi.yaml)
    if (weatherSchema?.properties?.temperature) {
      weatherSchema.properties.temperature.realisticTemperature = true;
    }

    const validateWeather = ajv.compile(weatherSchema);

    const sendValidationFailed = (res, message, details) => {
      return res.status(400).json({
        error: 'VALIDATION_FAILED',
        message,
        details,
      });
    };

    // --- AJV middleware: only for POST /weather ---
    const weatherValidateMw = (req, res, next) => {
      if (req.method !== 'POST' || req.path !== '/weather') return next();

      console.log('AJV middleware executed');

      const ok = validateWeather(req.body);

      // 1) Schema validation errors
      if (!ok) {
        const details = (validateWeather.errors || []).map((e) => ({
          path: e.instancePath || e.schemaPath,
          message: e.message,
        }));
        return sendValidationFailed(res, 'Invalid weather payload', details);
      }

      // 2) Business rules (assignment)
      const { cityCode, temperature } = req.body || {};

      // DXB: temperature must be > 0
      if (cityCode === 'DXB' && !(typeof temperature === 'number' && temperature > 0)) {
        return sendValidationFailed(res, 'Business rule validation failed', [
          { path: '/temperature', message: 'For DXB, temperature must be > 0' },
        ]);
      }

      // HEL: temperature must be between -40 and 40
      if (
        cityCode === 'HEL' &&
        !(typeof temperature === 'number' && temperature >= -40 && temperature <= 40)
      ) {
        return sendValidationFailed(res, 'Business rule validation failed', [
          { path: '/temperature', message: 'For HEL, temperature must be between -40 and 40' },
        ]);
      }

      return next();
    };

    // IMPORTANT: Register BEFORE OpenApiValidator to prove middleware order.
    // For the assignment “reorder” experiment, move this line BELOW OpenApiValidator.middleware.
    this.app.use(weatherValidateMw);

    // Simple test endpoint
    this.app.get('/hello', (req, res) => res.send(`Hello World. path: ${this.openApiPath}`));

    // Serve OpenAPI document
    this.app.get('/openapi', (req, res) =>
      res.sendFile(path.join(__dirname, 'api', 'openapi.yaml')),
    );

    // Swagger UI
    this.app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(this.schema));

    this.app.get('/login-redirect', (req, res) => {
      res.status(200);
      res.json(req.query);
    });

    this.app.get('/oauth2-redirect.html', (req, res) => {
      res.status(200);
      res.json(req.query);
    });

    // MUST remain: OpenAPI routing via operationHandlers
    this.app.use(
      OpenApiValidator.middleware({
        apiSpec: this.openApiPath,
        operationHandlers: path.join(__dirname),
        fileUploader: { dest: config.FILE_UPLOAD_PATH },
        validateRequests: false,
      }),
    );
  }

  launch() {
    this.app.use((err, req, res, next) => {
      res.status(err.status || 500).json({
        message: err.message || err,
        errors: err.errors || '',
      });
    });

    http.createServer(this.app).listen(this.port);
    console.log(`Listening on port ${this.port}`);
  }

  async close() {
    if (this.server !== undefined) {
      await this.server.close();
      console.log(`Server on port ${this.port} shut down`);
    }
  }
}

module.exports = ExpressServer;