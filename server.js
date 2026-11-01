const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Serve static dashboard files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// --- MongoDB Local Connection ---
const MONGO_URI = 'mongodb://127.0.0.1:27017/HemaPath_IoT';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB successfully [Database: HemaPath_IoT]'))
  .catch((err) => console.error('MongoDB connection error:', err));

// --- Schemas & Models ---

// 1. Telemetry Log Schema
const telemetrySchema = new mongoose.Schema({
  unit_id: { type: String, required: true },
  temperature_celsius: { type: Number, required: true },
  humidity_percent: { type: Number, required: true },
  weight_grams: { type: Number, default: 450 },
  recorded_at: { type: Date, default: Date.now }
});

// 2. Blood Inventory Schema
const inventorySchema = new mongoose.Schema({
  unit_id: { type: String, required: true, unique: true },
  blood_type: { type: String, default: 'O+' },
  temperature_celsius: { type: Number, default: 4.0 },
  humidity_percent: { type: Number, default: 65.0 },
  weight_grams: { type: Number, default: 450 },
  viability_percent: { type: Number, default: 100 },
  decay_rate_k: { type: Number, default: 0 },
  status: { type: String, default: 'VIABLE' },
  last_updated: { type: Date, default: Date.now }
});

// 3. Blood Request Schema
const requestSchema = new mongoose.Schema({
  request_id: { type: String, required: true, unique: true },
  hospital_name: { type: String, required: true },
  blood_type: { type: String, required: true },
  units_requested: { type: Number, required: true },
  urgency: { type: String, default: 'Normal' },
  status: { type: String, default: 'PENDING' },
  requested_at: { type: Date, default: Date.now }
});

// 4. Transfer Schema
const transferSchema = new mongoose.Schema({
  transfer_id: { type: String, required: true, unique: true },
  unit_id: { type: String, required: true },
  source_location: { type: String, required: true },
  destination_location: { type: String, required: true },
  status: { type: String, default: 'IN_TRANSIT' },
  initiated_at: { type: Date, default: Date.now }
});

const TelemetryLog = mongoose.model('telemetry_logs', telemetrySchema);
const BloodInventory = mongoose.model('blood_inventory', inventorySchema);
const BloodRequest = mongoose.model('blood_requests', requestSchema);
const Transfer = mongoose.model('transfers', transferSchema);

// --- Arrhenius Kinetic Decay Calculation ---
function calculateKineticDecay(tempC, currentViability) {
  const R = 8.314;  // Ideal gas constant
  const Ea = 50000; // Activation energy for blood degradation
  const A = 1e6;    // Pre-exponential factor
  
  const tempK = tempC + 273.15;
  const decay_rate_k = A * Math.exp(-Ea / (R * tempK));
  
  const updatedViability = Math.max(0, currentViability - (decay_rate_k * 0.05));
  
  let status = 'VIABLE';
  if (tempC > 10.0 || updatedViability < 70) {
    status = 'THERMAL_DECAY_WARNING';
  }
  if (updatedViability <= 0) {
    status = 'EXPIRED';
  }

  return { updatedViability, decay_rate_k, status };
}

// --- API Endpoints ---

// 1. ESP32 Telemetry Ingestion Endpoint
app.post('/api/iot/update-storage', async (req, res) => {
  try {
    const { unit_id, temperature_celsius, humidity_percent, weight_grams } = req.body;

    if (!unit_id || temperature_celsius === undefined || humidity_percent === undefined) {
      return res.status(400).json({ error: 'Missing required payload fields' });
    }

    // Save telemetry log
    const newLog = new TelemetryLog({
      unit_id,
      temperature_celsius,
      humidity_percent,
      weight_grams: weight_grams || 450
    });
    await newLog.save();

    // Fetch or create inventory unit
    let inventory = await BloodInventory.findOne({ unit_id });
    if (!inventory) {
      inventory = new BloodInventory({ unit_id });
    }

    // Calculate dynamic kinetic decay
    const { updatedViability, decay_rate_k, status } = calculateKineticDecay(
      temperature_celsius,
      inventory.viability_percent
    );

    // Save updated telemetry metrics to inventory
    inventory.temperature_celsius = temperature_celsius;
    inventory.humidity_percent = humidity_percent;
    inventory.weight_grams = weight_grams || inventory.weight_grams || 450;
    inventory.viability_percent = updatedViability;
    inventory.decay_rate_k = decay_rate_k;
    inventory.status = status;
    inventory.last_updated = new Date();

    await inventory.save();

    return res.status(200).json({
      message: 'Telemetry processed successfully',
      unit_id,
      viability_percent: updatedViability,
      status
    });
  } catch (error) {
    console.error("Telemetry Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. Blood Inventory Endpoint
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await BloodInventory.find().sort({ last_updated: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Hospital Requests Endpoints
app.get('/api/blood-requests', async (req, res) => {
  try {
    const requests = await BloodRequest.find().sort({ requested_at: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/blood-requests', async (req, res) => {
  try {
    const { request_id, hospital_name, blood_type, blood_group, units_requested, urgency, status } = req.body;
    
    const request = new BloodRequest({
      request_id: request_id || ("REQ-" + Date.now().toString().slice(-4)),
      hospital_name: hospital_name || "General Hospital",
      blood_type: blood_type || blood_group || "O+",
      units_requested: Number(units_requested) || 1,
      urgency: urgency || "Normal",
      status: status || "PENDING"
    });

    const savedRequest = await request.save();
    res.status(201).json({ message: 'Request created', request: savedRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Transfers Endpoints
app.get('/api/transfers', async (req, res) => {
  try {
    const transfers = await Transfer.find().sort({ initiated_at: -1 });
    res.json(transfers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transfers', async (req, res) => {
  try {
    const { transfer_id, unit_id, source_location, destination_location, status } = req.body;

    const transfer = new Transfer({
      transfer_id: transfer_id || ("TRF-" + Date.now().toString().slice(-4)),
      unit_id,
      source_location,
      destination_location,
      status: status || "IN_TRANSIT"
    });

    const savedTransfer = await transfer.save();
    res.status(201).json({ message: 'Transfer initiated', transfer: savedTransfer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/match/:blood_type
app.get('/api/inventory/match/:blood_type', async (req, res) => {
  try {
    const { blood_type } = req.params;
    
    // Find matching units that are VIABLE and sorted by highest viability
    const matchingUnits = await BloodInventory.find({
      blood_type: blood_type.toUpperCase(),
      status: 'VIABLE'
    }).sort({ viability_percent: -1 });

    res.json({
      requested_type: blood_type,
      count: matchingUnits.length,
      available_units: matchingUnits
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(` HemaPath Backend running on http://0.0.0.0:${PORT}`);
  console.log(` Target database: ${MONGO_URI}`);
  console.log(`===================================================`);
});
