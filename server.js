const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const uri = "mongodb+srv://username:password@hemapath-cluster.sbrdvcb.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

async function startServer() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas");

        // 1. IoT Telemetry Route
        app.post('/api/iot/update-storage', async (req, res) => {
            try {
                const db = client.db('HemaPath_IoT');
                const collection = db.collection('blood_requests'); // or blood_inventory
                const result = await client.db('HemaPath_IoT').collection('blood_inventory').updateOne(
                    { unit_id: req.body.unit_id },
                    { $set: { ...req.body, last_updated: new Date() } },
                    { upsert: true }
                );
                res.json({ success: true, message: "IoT Data synchronized successfully", result });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // 2. Create Blood Request Route
        app.post('/api/requests', async (req, res) => {
            try {
                const db = client.db('HemaPath_IoT');
                const collection = db.collection('blood_requests');
                const newRequest = {
                    request_id: "REQ-" + Date.now(),
                    hospital_name: req.body.hospital_name,
                    blood_group: req.body.blood_group,
                    units_requested: req.body.units_requested,
                    urgency: req.body.urgency || "Normal",
                    status: "Pending",
                    request_date: new Date()
                };
                const result = await collection.insertOne(newRequest);
                res.status(201).json({ success: true, message: "Blood request logged successfully", result });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
// 3. Log a new blood transfer / shipment
app.post('/api/transfers', async (req, res) => {
    try {
        const db = client.db('HemaPath_IoT');
        const collection = db.collection('transfers');
        
        const newTransfer = {
            transfer_id: "TRF-" + Date.now(),
            unit_id: req.body.unit_id,
            source_facility: req.body.source_facility,
            destination_facility: req.body.destination_facility,
            status: req.body.status || "In Transit", // In Transit, Delivered, Cancelled
            dispatched_at: new Date()
        };

        const result = await collection.insertOne(newTransfer);
        res.status(201).json({ success: true, message: "Blood transfer logged successfully", result });
    } catch (err) {
        console.error("Error logging transfer:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// 4. Get all blood inventory telemetry units
app.get('/api/inventory', async (req, res) => {
    try {
        const db = client.db('HemaPath_IoT');
        const collection = db.collection('blood_inventory');
        const inventory = await collection.find({}).toArray();
        res.status(200).json(inventory);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Get all hospital blood requests (Already mentioned earlier, ensure it's here)
app.get('/api/requests', async (req, res) => {
    try {
        const db = client.db('HemaPath_IoT');
        const collection = db.collection('blood_requests');
        const requests = await collection.find({}).toArray();
        res.status(200).json(requests);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Get all blood transfers
app.get('/api/transfers', async (req, res) => {
    try {
        const db = client.db('HemaPath_IoT');
        const collection = db.collection('transfers');
        const transfers = await collection.find({}).toArray();
        res.status(200).json(transfers);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
        app.listen(3000, () => {
            console.log("Server running on port 3000");
        });
    } catch (err) {
        console.error("Database connection failed:", err);
    }
}

startServer();
