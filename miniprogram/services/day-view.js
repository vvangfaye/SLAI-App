const planner = require('./planner');
const holidays = require('../utils/holidays');
function view(cells, date) {
  try {
    const data = planner.read();
    return { cells: planner.decorate(cells, data), personalDay: planner.onDate(data, date), holiday: holidays.info(date), personalError: '' };
  } catch (e) { return { cells, personalDay: { leaves: [], events: [] }, holiday: holidays.info(date), personalError: e.message }; }
}
module.exports = { view };
