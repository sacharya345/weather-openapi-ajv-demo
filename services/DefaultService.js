/* eslint-disable no-unused-vars */
const Service = require('./Service');

/**
* Get all weather reports
*
* returns List
* */
const weatherGET = () => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Create a weather report
*
* weather Weather 
* no response value expected for this operation
* */
const weatherPOST = ({ weather }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        weather,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);

module.exports = {
  weatherGET,
  weatherPOST,
};
