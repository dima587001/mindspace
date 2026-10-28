// src/app.js
const express = require('express');
const cors = require('cors');

const { updatePulse } = require('./controllers/pulse.controller');
const { assignTask } = require('./controllers/task.controller');

const app = express();

app.use(cors());
app.use(express.json());

// Маршруты API
app.post('/api/pulse/:id', updatePulse);
app.post('/api/tasks/assign', assignTask);

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Synapse Net Backend запущен на порту ${PORT}`);
  });
}

module.exports = app;
