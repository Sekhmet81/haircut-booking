require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Resend } = require("resend");

const app = express();
const PORT = 3001;

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'user_sessions',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8
    }
}));
app.use(express.json());

const createSessionTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                sid VARCHAR NOT NULL PRIMARY KEY,
                sess JSON NOT NULL,
                expire TIMESTAMP(6) NOT NULL
            )
        `);

        console.log('Session table is ready.');
    } catch (error) {
        console.error('Error creating session table:', error);
        process.exit(1);
    }
};

createSessionTable();

// ============================================
// HOME
// ============================================

app.get('/', (req, res) => {
    res.json({
        message: 'Haircut Booking API is running!'
    });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            error: 'Username and password are required'
        });
    }

    try {
        const result = await pool.query(
            `
            SELECT
                id,
                username,
                password_hash,
                role,
                barber_id,
                active
            FROM users
            WHERE username = $1
            `,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const user = result.rows[0];

        if (!user.active) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            barber_id: user.barber_id
        };

        res.json({
            message: 'Login successful',
            user: req.session.user
        });

    } catch (error) {
        console.error('Login error:', error);

        res.status(500).json({
            error: 'Failed to log in'
        });
    }
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({
            error: 'Not logged in'
        });
    }

    res.json({
        user: req.session.user
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout error:', error);

            return res.status(500).json({
                error: 'Failed to log out'
            });
        }

        res.clearCookie('connect.sid');

        res.json({
            message: 'Logout successful'
        });
    });
});

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({
            error: 'Authentication required'
        });
    }

    next();
};


const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({
                error: 'Authentication required'
            });
        }

        if (!roles.includes(req.session.user.role)) {
            return res.status(403).json({
                error: 'Access denied'
            });
        }

        next();
    };
};

app.get(
    '/api/barber/appointments',
    requireRole('barber'),
    async (req, res) => {
        try {
            const barberId = req.session.user.barber_id;

            if (!barberId) {
                return res.status(403).json({
                    error: 'Barber account is not assigned to a barber'
                });
            }

            const result = await pool.query(
                `
                SELECT
                    a.id,
                    a.barber_id,
                    a.service_id,
                    a.appointment_date,
                    a.start_time,
                    a.end_time,
                    a.customer_name,
                    a.customer_phone,
                    a.customer_email,
                    a.status,
                    s.name AS service,
                    s.price
                FROM appointments a
                JOIN services s
                    ON a.service_id = s.id
                WHERE a.barber_id = $1
                ORDER BY
                    a.appointment_date,
                    a.start_time
                `,
                [barberId]
            );

            res.json(result.rows);

        } catch (error) {
            console.error('Error loading barber appointments:', error);

            res.status(500).json({
                error: 'Failed to load appointments'
            });
        }
    }
);

// ============================================
// DATABASE TEST
// ============================================

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');

        res.json({
            message: 'PostgreSQL connection successful!',
            time: result.rows[0].now
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Database connection failed'
        });
    }
});


// ============================================
// GET ALL SERVICES
// ============================================

app.get('/api/services', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                name,
                duration_minutes,
                price
            FROM services
            WHERE active = TRUE
            ORDER BY name
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Failed to retrieve services'
        });
    }
});

// ADMIN: Get all services
app.get('/api/admin/services', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM services
             ORDER BY name`
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Error loading services:', error);

        res.status(500).json({
            error: 'Failed to load services'
        });
    }
});

// ADMIN: Add a service
app.post('/api/admin/services', requireRole('admin'), async (req, res) => {
    const {
        name,
        duration_minutes,
        price
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({
            error: 'Service name is required'
        });
    }

    if (!duration_minutes || Number(duration_minutes) <= 0) {
        return res.status(400).json({
            error: 'Duration must be greater than 0'
        });
    }

    if (price === undefined || Number(price) < 0) {
        return res.status(400).json({
            error: 'Price must be 0 or greater'
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO services
             (name, duration_minutes, price)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [
                name.trim(),
                Number(duration_minutes),
                Number(price)
            ]
        );

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Error adding service:', error);

        res.status(500).json({
            error: 'Failed to add service'
        });
    }
});

// ADMIN: Edit a service
app.put('/api/admin/services/:id', requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    const {
        name,
        duration_minutes,
        price,
        active
    } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({
            error: 'Service name is required'
        });
    }

    if (!duration_minutes || Number(duration_minutes) <= 0) {
        return res.status(400).json({
            error: 'Duration must be greater than 0'
        });
    }

    if (price === undefined || Number(price) < 0) {
        return res.status(400).json({
            error: 'Price must be 0 or greater'
        });
    }

    try {
        const result = await pool.query(
            `UPDATE services
             SET name = $1,
                 duration_minutes = $2,
                 price = $3,
                 active = $4
             WHERE id = $5
             RETURNING *`,
            [
                name.trim(),
                Number(duration_minutes),
                Number(price),
                active !== false,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Service not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error updating service:', error);

        res.status(500).json({
            error: 'Failed to update service'
        });
    }
});

// ADMIN: Deactivate a service
app.delete('/api/admin/services/:id', requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE services
             SET active = FALSE
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Service not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error deactivating service:', error);

        res.status(500).json({
            error: 'Failed to deactivate service'
        });
    }
});

// ADMIN: Cancel an appointment
app.put('/api/admin/appointments/:id/cancel', requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `
            UPDATE appointments
            SET status = 'cancelled'
            WHERE id = $1
              AND status = 'scheduled'
            RETURNING *
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found or already cancelled'
            });
        }

        res.json({
            message: 'Appointment cancelled successfully',
            appointment: result.rows[0]
        });

    } catch (error) {
        console.error('Error cancelling appointment:', error);

        res.status(500).json({
            error: 'Failed to cancel appointment'
        });
    }
});

app.put(
    '/api/barber/appointments/:id/cancel',
    requireRole('barber'),
    async (req, res) => {
        try {
            const appointmentId = req.params.id;
            const barberId = req.session.user.barber_id;

            if (!barberId) {
                return res.status(403).json({
                    error: 'Barber account is not assigned to a barber'
                });
            }

            const result = await pool.query(
                `
                UPDATE appointments
                SET status = 'cancelled'
                WHERE id = $1
                  AND barber_id = $2
                  AND status <> 'cancelled'
                RETURNING
                    id,
                    appointment_date,
                    start_time,
                    end_time,
                    customer_name,
                    status
                `,
                [appointmentId, barberId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Appointment not found or does not belong to this barber'
                });
            }

            res.json({
                message: 'Appointment cancelled successfully',
                appointment: result.rows[0]
            });

        } catch (error) {
            console.error('Error cancelling barber appointment:', error);

            res.status(500).json({
                error: 'Failed to cancel appointment'
            });
        }
    }
);

app.put(
    '/api/barber/appointments/:id/reschedule',
    requireRole('barber'),
    async (req, res) => {
        try {
            const appointmentId = req.params.id;
            const barberId = req.session.user.barber_id;
            const { appointment_date, start_time } = req.body;

            if (!barberId) {
                return res.status(403).json({
                    error: 'Barber account is not assigned to a barber'
                });
            }

            if (!appointment_date || !start_time) {
                return res.status(400).json({
                    error: 'Appointment date and start time are required'
                });
            }

            // Get the appointment and make sure it belongs to this barber
            const appointmentResult = await pool.query(
                `
                SELECT
                    a.id,
                    a.barber_id,
                    a.service_id,
                    s.duration_minutes
                FROM appointments a
                JOIN services s
                    ON a.service_id = s.id
                WHERE a.id = $1
                  AND a.barber_id = $2
                `,
                [appointmentId, barberId]
            );

            if (appointmentResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'Appointment not found or does not belong to this barber'
                });
            }

            const appointment = appointmentResult.rows[0];

            // Calculate the new end time
            const duration = appointment.duration_minutes;

            const [hours, minutes] = start_time
                .split(':')
                .map(Number);

            const startMinutes = hours * 60 + minutes;
            const endMinutes = startMinutes + duration;

            const endHours = Math.floor(endMinutes / 60);
            const endMins = endMinutes % 60;

            const endTime =
                `${String(endHours).padStart(2, '0')}:` +
                `${String(endMins).padStart(2, '0')}:00`;

            // Check business hours
            const dayResult = await pool.query(
                `
                SELECT
                    open_time,
                    close_time,
                    closed
                FROM business_hours
                WHERE day_of_week =
                    EXTRACT(DOW FROM $1::date)
                `,
                [appointment_date]
            );

            if (dayResult.rows.length === 0) {
                return res.status(400).json({
                    error: 'Business hours not configured for this day'
                });
            }

            const businessDay = dayResult.rows[0];

            if (businessDay.closed) {
                return res.status(400).json({
                    error: 'The business is closed on this day'
                });
            }

            if (
                start_time < businessDay.open_time ||
                endTime > businessDay.close_time
            ) {
                return res.status(400).json({
                    error: 'The appointment falls outside business hours'
                });
            }

            // Update the appointment
            const result = await pool.query(
                `
                UPDATE appointments
                SET
                    appointment_date = $1,
                    start_time = $2,
                    end_time = $3
                WHERE id = $4
                  AND barber_id = $5
                RETURNING
                    id,
                    appointment_date,
                    start_time,
                    end_time,
                    status
                `,
                [
                    appointment_date,
                    start_time,
                    endTime,
                    appointmentId,
                    barberId
                ]
            );

            res.json({
                message: 'Appointment rescheduled successfully',
                appointment: result.rows[0]
            });

        } catch (error) {

            if (error.code === '23P01') {
                return res.status(409).json({
                    error: 'That time conflicts with another appointment'
                });
            }

            console.error(
                'Error rescheduling barber appointment:',
                error
            );

            res.status(500).json({
                error: 'Failed to reschedule appointment'
            });
        }
    }
);

// ============================================
// GET ALL BARBERS
// ============================================

app.get('/api/barbers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                name
            FROM barbers
            WHERE active = TRUE
            ORDER BY name
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Failed to retrieve barbers'
        });
    }
});

// ADMIN: Add a barber
app.post('/api/admin/barbers', requireRole('admin'), async (req, res) => {
    const { name } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({
            error: 'Barber name is required'
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO barbers (name)
             VALUES ($1)
             RETURNING *`,
            [name.trim()]
        );

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Error adding barber:', error);

        res.status(500).json({
            error: 'Failed to add barber'
        });
    }
});

// ADMIN: Edit a barber
app.put('/api/admin/barbers/:id', requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const { name, active } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({
            error: 'Barber name is required'
        });
    }

    try {
        const result = await pool.query(
            `UPDATE barbers
             SET name = $1,
                 active = $2
             WHERE id = $3
             RETURNING *`,
            [
                name.trim(),
                active !== false,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Barber not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error updating barber:', error);

        res.status(500).json({
            error: 'Failed to update barber'
        });
    }
});

// ADMIN: Deactivate a barber
app.delete('/api/admin/barbers/:id', requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE barbers
             SET active = FALSE
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Barber not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error deactivating barber:', error);

        res.status(500).json({
            error: 'Failed to deactivate barber'
        });
    }
});

// ADMIN: Get all barbers
app.get('/api/admin/barbers', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM barbers
             ORDER BY name`
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Error loading barbers:', error);

        res.status(500).json({
            error: 'Failed to load barbers'
        });
    }
});

// ============================================
// GET BUSINESS HOURS
// ============================================

app.get('/api/business-hours', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                day_of_week,
                open_time,
                close_time,
                closed
            FROM business_hours
            ORDER BY day_of_week
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Failed to retrieve business hours'
        });
    }
});

// ADMIN: Get all business hours
app.get('/api/admin/business-hours', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM business_hours
             ORDER BY day_of_week`
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Error loading business hours:', error);

        res.status(500).json({
            error: 'Failed to load business hours'
        });
    }
});

// ADMIN: Update business hours
app.put('/api/admin/business-hours/:day', requireRole('admin'), async (req, res) => {
    const { day } = req.params;

    const {
        open_time,
        close_time,
        closed
    } = req.body;

    const dayNumber = Number(day);

    if (
        !Number.isInteger(dayNumber) ||
        dayNumber < 0 ||
        dayNumber > 6
    ) {
        return res.status(400).json({
            error: 'Invalid day of week'
        });
    }

    if (!closed && (!open_time || !close_time)) {
        return res.status(400).json({
            error: 'Open and close times are required'
        });
    }

    if (!closed && open_time >= close_time) {
        return res.status(400).json({
            error: 'Closing time must be after opening time'
        });
    }

    try {
        const result = await pool.query(
            `UPDATE business_hours
             SET open_time = $1,
                 close_time = $2,
                 closed = $3
             WHERE day_of_week = $4
             RETURNING *`,
            [
                closed ? '00:00' : open_time,
                closed ? '00:00' : close_time,
                closed,
                dayNumber
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Business day not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error updating business hours:', error);

        res.status(500).json({
            error: 'Failed to update business hours'
        });
    }
});

// ADMIN: Get all appointments
app.get('/api/admin/appointments', requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                a.id,
                a.barber_id,
                a.service_id,
                a.appointment_date,
                a.start_time,
                a.end_time,
                a.customer_name,
                a.customer_phone,
                a.customer_email,
                a.status,
                b.name AS barber,
                s.name AS service,
                s.price
            FROM appointments a
            JOIN barbers b
                ON a.barber_id = b.id
            JOIN services s
                ON a.service_id = s.id
            ORDER BY
                a.appointment_date,
                a.start_time
            `
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Error loading appointments:', error);

        res.status(500).json({
            error: 'Failed to load appointments'
        });
    }
});


// ============================================
// GET APPOINTMENTS FOR A DATE
// ============================================
//
// Example:
// /api/availability?date=2026-09-05
//
// Optional barber:
// /api/availability?date=2026-09-05&barber_id=1
//

app.get('/api/availability', async (req, res) => {
    const { date, barber_id } = req.query;

    if (!date) {
        return res.status(400).json({
            error: 'Date is required'
        });
    }

    try {
        // Get appointments for the selected date
        let appointmentQuery = `
            SELECT
                a.id,
                a.barber_id,
                b.name AS barber,
                a.service_id,
                s.name AS service,
                a.customer_name,
                a.appointment_date,
                a.start_time,
                a.end_time
            FROM appointments a
            JOIN barbers b
                ON a.barber_id = b.id
            JOIN services s
                ON a.service_id = s.id
                WHERE a.appointment_date = $1
                  AND a.status = 'scheduled'
        `;

        const appointmentParams = [date];

        if (barber_id) {
            appointmentQuery += ` AND a.barber_id = $2`;
            appointmentParams.push(barber_id);
        }

        appointmentQuery += ` ORDER BY a.start_time`;

        const appointmentResult = await pool.query(
            appointmentQuery,
            appointmentParams
        );

        // Get business hours for the selected date
        const hoursResult = await pool.query(
            `
            SELECT
                day_of_week,
                open_time,
                close_time,
                closed
            FROM business_hours
            WHERE day_of_week = EXTRACT(DOW FROM $1::date)
            `,
            [date]
        );

        const businessHours = hoursResult.rows[0] || null;

        res.json({
            appointments: appointmentResult.rows,
            business_hours: businessHours
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Failed to retrieve availability'
        });
    }
});


// ============================================
// GET ALL APPOINTMENTS
// ============================================

app.get('/api/appointments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                a.id,
                a.barber_id,
                a.service_id,
                a.appointment_date,
                a.start_time,
                a.end_time,
                a.customer_name,
                a.customer_phone,
                a.customer_email,
                a.status,
                b.name AS barber,
                s.name AS service,
                s.price
            FROM appointments a
            JOIN barbers b
                ON a.barber_id = b.id
            JOIN services s
                ON a.service_id = s.id
            ORDER BY
                a.appointment_date,
                a.start_time
        `);

        res.json(result.rows);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Failed to retrieve appointments'
        });
    }
});


// ============================================
// CREATE APPOINTMENT
// ============================================

app.post('/api/appointments', async (req, res) => {

    const {
        barber_id,
        service_id,
        customer_name,
        customer_phone,
        customer_email,
        appointment_date,
        start_time
    } = req.body;

    // -----------------------------
    // Validate required fields
    // -----------------------------

    if (
        !barber_id ||
        !service_id ||
        !customer_name ||
        !appointment_date ||
        !start_time
    ) {
        return res.status(400).json({
            error: 'Barber, service, customer name, date, and start time are required'
        });
    }


    try {

        // -----------------------------
        // Get service duration
        // -----------------------------

        const serviceResult = await pool.query(
            `
            SELECT name, duration_minutes
            FROM services
            WHERE id = $1
              AND active = TRUE
            `,
            [service_id]
        );

        if (serviceResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Service not found'
            });
        }

        const duration = serviceResult.rows[0].duration_minutes;
        const serviceName = serviceResult.rows[0].name;

        // -----------------------------
        // Get barber name
        // -----------------------------

        const barberResult = await pool.query(
            `
            SELECT name
            FROM barbers
            WHERE id = $1
              AND active = TRUE
            `,
            [barber_id]
        );
        
        if (barberResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Barber not found'
            });
        }
        
        const barberName = barberResult.rows[0].name;

        // -----------------------------
        // Check business hours
        // -----------------------------

        const hoursResult = await pool.query(
            `
            SELECT
                open_time,
                close_time,
                closed
            FROM business_hours
            WHERE day_of_week = EXTRACT(DOW FROM $1::date)
            `,
            [appointment_date]
        );

        if (hoursResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Business hours are not configured for this day'
            });
        }

        const businessHours = hoursResult.rows[0];

        if (businessHours.closed) {
            return res.status(400).json({
                error: 'The business is closed on this day'
            });
        }

        // -----------------------------
        // Calculate end time
        // -----------------------------

        const timeResult = await pool.query(
            `
            SELECT
                $1::time + ($2::integer * INTERVAL '1 minute')
                AS end_time
            `,
            [start_time, duration]
        );

        const end_time = timeResult.rows[0].end_time;

        const formattedDate = new Date(
            `${appointment_date}T00:00:00`
        ).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        
        const formattedTime = new Date(
            `1970-01-01T${start_time}`
        ).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });

        // -----------------------------
        // Validate appointment time
        // -----------------------------

        const appointmentTimeResult = await pool.query(
            `
            SELECT
                $1::time AS start_time,
                $2::time AS end_time,
                $3::time AS open_time,
                $4::time AS close_time
            `,
            [
                start_time,
                end_time,
                businessHours.open_time,
                businessHours.close_time
            ]
        );

        const appointmentTimes = appointmentTimeResult.rows[0];

        if (
            appointmentTimes.start_time < appointmentTimes.open_time ||
            appointmentTimes.end_time > appointmentTimes.close_time
        ) {
            return res.status(400).json({
                error: 'The appointment time is outside business hours'
            });
        }

        const manageToken = crypto.randomBytes(32).toString('hex');

        const manageTokenHash = crypto
            .createHash('sha256')
            .update(manageToken)
            .digest('hex');

        const manageUrl =
            `${process.env.FRONTEND_URL}/manage-appointment/${manageToken}`;

        // -----------------------------
        // Create appointment
        // -----------------------------

        const result = await pool.query(
            `
            INSERT INTO appointments
            (
                barber_id,
                service_id,
                customer_name,
                customer_phone,
                customer_email,
                appointment_date,
                start_time,
                end_time,
                manage_token_hash
            )
            VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            `,
            [
                barber_id,
                service_id,
                customer_name,
                customer_phone || null,
                customer_email,
                appointment_date,
                start_time,
                end_time,
                manageTokenHash
            ]
        );


        // -----------------------------
        // Send confirmation email
        // -----------------------------

        const { data: emailData, error: emailError } =
            await resend.emails.send({
                from: 'Haircut Booking <onboarding@resend.dev>',
                to: [customer_email],
                subject: 'Your Haircut Appointment is Confirmed',
                html: `
                    <div style="
                        margin: 0;
                        padding: 40px 20px;
                        background-color: #f4f4f4;
                        font-family: Arial, sans-serif;
                    ">

                        <div style="
                            max-width: 500px;
                            margin: 0 auto;
                            background-color: #ffffff;
                            border-radius: 10px;
                            padding: 30px;
                            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                        ">

                            <h2 style="
                                margin-top: 0;
                                margin-bottom: 10px;
                                text-align: center;
                                color: #222222;
                            ">
                                Appointment Confirmed!
                            </h2>

                            <p style="
                                text-align: center;
                                color: #555555;
                                margin-bottom: 30px;
                            ">
                                Hi ${customer_name},
                            </p>

                            <p style="
                                color: #333333;
                                line-height: 1.6;
                            ">
                                Your haircut appointment has been successfully booked.
                            </p>

                            <div style="
                                background-color: #f5f5f5;
                                border-radius: 8px;
                                padding: 20px;
                                margin: 25px 0;
                            ">

                                <h3 style="
                                    margin-top: 0;
                                    margin-bottom: 15px;
                                    color: #222222;
                                ">
                                    Appointment Details
                                </h3>

                                <p style="
                                    margin: 10px 0;
                                    color: #333333;
                                ">
                                    <strong>Service:</strong> ${serviceName}
                                </p>

                                <p style="
                                    margin: 10px 0;
                                    color: #333333;
                                ">
                                    <strong>Barber:</strong> ${barberName}
                                </p>

                                <p style="
                                    margin: 10px 0;
                                    color: #333333;
                                ">
                                    <strong>Date:</strong> ${formattedDate}
                                </p>

                                <p style="
                                    margin: 10px 0;
                                    color: #333333;
                                ">
                                    <strong>Time:</strong> ${formattedTime}
                                </p>

                            </div>

                            <p style="
                                color: #333333;
                                line-height: 1.6;
                            ">
                                Need to make a change to your appointment?
                            </p>

                            <div style="
                                text-align: center;
                                margin: 25px 0;
                            ">

                                <a
                                    href="${manageUrl}"
                                    style="
                                        display: inline-block;
                                        padding: 14px 24px;
                                        background-color: #222222;
                                        color: #ffffff;
                                        text-decoration: none;
                                        border-radius: 6px;
                                        font-weight: bold;
                                    "
                                >
                                    Manage Appointment
                                </a>

                            </div>

                            <p style="
                                color: #666666;
                                font-size: 14px;
                                line-height: 1.5;
                                text-align: center;
                            ">
                                From the Manage Appointment page, you can reschedule or
                                cancel your appointment.
                            </p>

                            <p style="
                                margin-top: 30px;
                                color: #333333;
                                text-align: center;
                            ">
                                Thank you for booking with us!
                            </p>

                        </div>

                    </div>`
            });

        if (emailError) {
            console.error('Confirmation email failed:', emailError);
        } else {
            console.log(`Confirmation email sent to ${customer_email}`);
        }

        // -----------------------------
        // Success
        // -----------------------------

        res.status(201).json({
            message: 'Appointment booked successfully',
            appointment: result.rows[0]
        });


    } catch (error) {

        console.error(error);


        // -----------------------------
        // Double booking
        // -----------------------------

        if (error.code === '23P01') {
            return res.status(409).json({
                error: 'That time slot is already booked'
            });
        }


        // -----------------------------
        // Other database error
        // -----------------------------

        res.status(500).json({
            error: 'Failed to create appointment'
        });
    }
});

app.get('/api/appointments/manage/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const manageTokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const result = await pool.query(
            `
            SELECT
                a.id,
                a.barber_id,
                a.service_id,
                a.customer_name,
                a.customer_email,
                a.appointment_date,
                a.start_time,
                a.end_time,
                a.status,
                s.name AS service_name,
                s.duration_minutes AS service_duration,
                b.name AS barber_name
            FROM appointments a
            JOIN services s
                ON a.service_id = s.id
            JOIN barbers b
                ON a.barber_id = b.id
            WHERE a.manage_token_hash = $1
            `,
            [manageTokenHash]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error loading managed appointment:', error);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

app.put('/api/appointments/manage/:token/reschedule', async (req, res) => {
    try {
        const { token } = req.params;
        const { appointment_date, start_time } = req.body;

        if (!appointment_date || !start_time) {
            return res.status(400).json({
                error: 'Appointment date and start time are required'
            });
        }

        const manageTokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        // Find the appointment using the secure token
        const appointmentResult = await pool.query(
            `
            SELECT
                id,
                barber_id,
                service_id,
                status
            FROM appointments
            WHERE manage_token_hash = $1
            `,
            [manageTokenHash]
        );

        if (appointmentResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found'
            });
        }

        const appointment = appointmentResult.rows[0];

        // Don't allow rescheduling a cancelled appointment
        if (appointment.status === 'cancelled') {
            return res.status(400).json({
                error: 'Cancelled appointments cannot be rescheduled'
            });
        }

        // Get the service duration
        const serviceResult = await pool.query(
            `
            SELECT duration_minutes
            FROM services
            WHERE id = $1
              AND active = TRUE
            `,
            [appointment.service_id]
        );

        if (serviceResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Service not found'
            });
        }

        const duration = serviceResult.rows[0].duration_minutes;

        // Get business hours for the selected date
        const dayOfWeek = new Date(
            `${appointment_date}T00:00:00`
        ).getDay();

        const businessHoursResult = await pool.query(
            `
            SELECT open_time, close_time, closed
            FROM business_hours
            WHERE day_of_week = $1
            `,
            [dayOfWeek]
        );

        if (businessHoursResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Business hours not found'
            });
        }

        const businessHours = businessHoursResult.rows[0];

        if (businessHours.closed) {
            return res.status(400).json({
                error: 'The shop is closed on that day'
            });
        }

        // Convert times to minutes
        const [startHour, startMinute] = start_time
            .substring(0, 5)
            .split(':')
            .map(Number);

        const [closeHour, closeMinute] = businessHours.close_time
            .substring(0, 5)
            .split(':')
            .map(Number);

        const [openHour, openMinute] = businessHours.open_time
            .substring(0, 5)
            .split(':')
            .map(Number);

        const startMinutes = startHour * 60 + startMinute;
        const openMinutes = openHour * 60 + openMinute;
        const closeMinutes = closeHour * 60 + closeMinute;

        const endMinutes = startMinutes + duration;

        if (
            startMinutes < openMinutes ||
            endMinutes > closeMinutes
        ) {
            return res.status(400).json({
                error: 'Selected time is outside business hours'
            });
        }

        // Calculate end time
        const endHour = Math.floor(endMinutes / 60);
        const endMinute = endMinutes % 60;

        const endTime =
            `${String(endHour).padStart(2, '0')}:` +
            `${String(endMinute).padStart(2, '0')}:00`;

        // Update the appointment
        const result = await pool.query(
            `
            UPDATE appointments
            SET
                appointment_date = $1,
                start_time = $2,
                end_time = $3
            WHERE id = $4
            RETURNING *
            `,
            [
                appointment_date,
                start_time,
                endTime,
                appointment.id
            ]
        );
        
        const updatedAppointment = result.rows[0];
        
        // Get the information needed for the email
        const detailsResult = await pool.query(
            `
            SELECT
                a.customer_name,
                a.customer_email,
                a.appointment_date,
                a.start_time,
                s.name AS service_name,
                b.name AS barber_name
            FROM appointments a
            JOIN services s
                ON a.service_id = s.id
            JOIN barbers b
                ON a.barber_id = b.id
            WHERE a.id = $1
            `,
            [appointment.id]
        );
        
        const details = detailsResult.rows[0];
        
        // Format date for the email
        const formattedDate = new Date(
            `${appointment_date}T00:00:00`
        ).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        
        // Format time for the email
        const formattedTime = new Date(
            `1970-01-01T${start_time}`
        ).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });
        
        // Reuse the existing management link
        const manageUrl =
            `${process.env.FRONTEND_URL}/manage-appointment/${token}`;
        
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: details.customer_email,
            subject: 'Appointment Rescheduled',
            html: `
                <div style="
                    margin: 0;
                    padding: 40px 20px;
                    background-color: #f4f4f4;
                    font-family: Arial, sans-serif;
                ">

                    <div style="
                        max-width: 500px;
                        margin: 0 auto;
                        background-color: #ffffff;
                        border-radius: 10px;
                        padding: 30px;
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                    ">

                        <h2 style="
                            margin-top: 0;
                            margin-bottom: 10px;
                            text-align: center;
                            color: #222222;
                        ">
                            Appointment Rescheduled
                        </h2>

                        <p style="
                            text-align: center;
                            color: #555555;
                            margin-bottom: 30px;
                        ">
                            Hi ${details.customer_name},
                        </p>

                        <p style="
                            color: #333333;
                            line-height: 1.6;
                        ">
                            Your haircut appointment has been successfully rescheduled.
                        </p>

                        <div style="
                            background-color: #f5f5f5;
                            border-radius: 8px;
                            padding: 20px;
                            margin: 25px 0;
                        ">

                            <h3 style="
                                margin-top: 0;
                                margin-bottom: 15px;
                                color: #222222;
                            ">
                                Updated Appointment Details
                            </h3>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Service:</strong> ${details.service_name}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Barber:</strong> ${details.barber_name}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Date:</strong> ${formattedDate}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Time:</strong> ${formattedTime}
                            </p>

                        </div>

                        <p style="
                            color: #333333;
                            line-height: 1.6;
                        ">
                            Need to make another change to your appointment?
                        </p>

                        <div style="
                            text-align: center;
                            margin: 25px 0;
                        ">

                            <a
                                href="${manageUrl}"
                                style="
                                    display: inline-block;
                                    padding: 14px 24px;
                                    background-color: #222222;
                                    color: #ffffff;
                                    text-decoration: none;
                                    border-radius: 6px;
                                    font-weight: bold;
                                "
                            >
                                Manage Appointment
                            </a>

                        </div>

                        <p style="
                            color: #666666;
                            font-size: 14px;
                            line-height: 1.5;
                            text-align: center;
                        ">
                            From the Manage Appointment page, you can reschedule or
                            cancel your appointment.
                        </p>

                        <p style="
                            margin-top: 30px;
                            color: #333333;
                            text-align: center;
                        ">
                            Thank you for booking with us!
                        </p>

                    </div>

                </div>
            `
        });
        
        res.json({
            message: 'Appointment rescheduled successfully',
            appointment: updatedAppointment
        });

    } catch (error) {
        // PostgreSQL exclusion constraint = time already booked
        if (error.code === '23P01') {
            return res.status(409).json({
                error: 'That time is already booked'
            });
        }

        console.error('Error rescheduling appointment:', error);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

app.put('/api/appointments/manage/:token/cancel', async (req, res) => {
    try {
        const { token } = req.params;

        const manageTokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const appointmentResult = await pool.query(
            `
            SELECT
                id,
                status
            FROM appointments
            WHERE manage_token_hash = $1
            `,
            [manageTokenHash]
        );

        if (appointmentResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found'
            });
        }

        const appointment = appointmentResult.rows[0];

        if (appointment.status === 'cancelled') {
            return res.status(400).json({
                error: 'Appointment is already cancelled'
            });
        }

        const result = await pool.query(
            `
            UPDATE appointments
            SET status = 'cancelled'
            WHERE id = $1
            RETURNING *
            `,
            [appointment.id]
        );
        
        const cancelledAppointment = result.rows[0];
        
        const detailsResult = await pool.query(
            `
            SELECT
                a.customer_name,
                a.customer_email,
                a.appointment_date,
                a.start_time,
                s.name AS service_name,
                b.name AS barber_name
            FROM appointments a
            JOIN services s
                ON a.service_id = s.id
            JOIN barbers b
                ON a.barber_id = b.id
            WHERE a.id = $1
            `,
            [appointment.id]
        );
        
        const details = detailsResult.rows[0];
        
        const formattedDate = new Date(
            `${cancelledAppointment.appointment_date
                .toISOString()
                .substring(0, 10)}T00:00:00`
        ).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        
        const formattedTime = new Date(
            `1970-01-01T${cancelledAppointment.start_time}`
        ).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });
        
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: details.customer_email,
            subject: 'Appointment Cancelled',
            html: `
                <div style="
                    margin: 0;
                    padding: 40px 20px;
                    background-color: #f4f4f4;
                    font-family: Arial, sans-serif;
                ">

                    <div style="
                        max-width: 500px;
                        margin: 0 auto;
                        background-color: #ffffff;
                        border-radius: 10px;
                        padding: 30px;
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                    ">

                        <h2 style="
                            margin-top: 0;
                            margin-bottom: 10px;
                            text-align: center;
                            color: #222222;
                        ">
                            Appointment Cancelled
                        </h2>

                        <p style="
                            text-align: center;
                            color: #555555;
                            margin-bottom: 30px;
                        ">
                            Hi ${details.customer_name},
                        </p>

                        <p style="
                            color: #333333;
                            line-height: 1.6;
                        ">
                            Your haircut appointment has been cancelled.
                        </p>

                        <div style="
                            background-color: #f5f5f5;
                            border-radius: 8px;
                            padding: 20px;
                            margin: 25px 0;
                        ">

                            <h3 style="
                                margin-top: 0;
                                margin-bottom: 15px;
                                color: #222222;
                            ">
                                Cancelled Appointment
                            </h3>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Service:</strong> ${details.service_name}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Barber:</strong> ${details.barber_name}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Date:</strong> ${formattedDate}
                            </p>

                            <p style="
                                margin: 10px 0;
                                color: #333333;
                            ">
                                <strong>Time:</strong> ${formattedTime}
                            </p>

                        </div>

                        <p style="
                            color: #333333;
                            line-height: 1.6;
                        ">
                            If you would like to book another appointment,
                            you can return to the booking page.
                        </p>

                        <div style="
                            text-align: center;
                            margin: 25px 0;
                        ">

                            <a
                                href="${process.env.FRONTEND_URL}"
                                style="
                                    display: inline-block;
                                    padding: 14px 24px;
                                    background-color: #222222;
                                    color: #ffffff;
                                    text-decoration: none;
                                    border-radius: 6px;
                                    font-weight: bold;
                                "
                            >
                                Book Another Appointment
                            </a>

                        </div>

                        <p style="
                            margin-top: 30px;
                            color: #666666;
                            font-size: 14px;
                            line-height: 1.5;
                            text-align: center;
                        ">
                            Thank you for booking with us!
                        </p>

                    </div>

                </div>
            `
        });
        
        res.json({
            message: 'Appointment cancelled successfully',
            appointment: cancelledAppointment
        });

    } catch (error) {
        console.error('Error cancelling appointment:', error);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ============================================
// DELETE APPOINTMENT
// ============================================

app.delete('/api/appointments/:id', async (req, res) => {

    const { id } = req.params;

    try {

        const result = await pool.query(
            `
            DELETE FROM appointments
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );


        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found'
            });
        }


        res.json({
            message: 'Appointment cancelled',
            appointment: result.rows[0]
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: 'Failed to cancel appointment'
        });
    }
});

// =========================
// RESCHEDULE APPOINTMENT
// =========================

app.put('/api/admin/appointments/:id/reschedule', requireRole('admin'), async (req, res) => {
    const { id } = req.params;

    const {
        appointment_date,
        start_time
    } = req.body;

    if (!appointment_date || !start_time) {
        return res.status(400).json({
            error: 'Appointment date and start time are required'
        });
    }

    try {
        // Get the appointment and its service duration
        const appointmentResult = await pool.query(
            `
            SELECT
                a.id,
                a.service_id,
                a.status,
                s.duration_minutes
            FROM appointments a
            JOIN services s
                ON a.service_id = s.id
            WHERE a.id = $1
            `,
            [id]
        );

        if (appointmentResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Appointment not found'
            });
        }

        const appointment = appointmentResult.rows[0];

        // Only scheduled appointments can be rescheduled
        if (appointment.status !== 'scheduled') {
            return res.status(400).json({
                error: 'Only scheduled appointments can be rescheduled'
            });
        }

        const duration = appointment.duration_minutes;

        // Get business hours for the new date
        const hoursResult = await pool.query(
            `
            SELECT
                open_time,
                close_time,
                closed
            FROM business_hours
            WHERE day_of_week = EXTRACT(DOW FROM $1::date)
            `,
            [appointment_date]
        );

        if (hoursResult.rows.length === 0) {
            return res.status(400).json({
                error: 'Business hours are not configured for this day'
            });
        }

        const businessHours = hoursResult.rows[0];

        if (businessHours.closed) {
            return res.status(400).json({
                error: 'The business is closed on this day'
            });
        }

        // Calculate the new end time
        const timeResult = await pool.query(
            `
            SELECT
                $1::time + ($2::integer * INTERVAL '1 minute')
                AS end_time
            `,
            [start_time, duration]
        );

        const end_time = timeResult.rows[0].end_time;

        // Check that the new appointment fits inside business hours
        const appointmentTimeResult = await pool.query(
            `
            SELECT
                $1::time AS start_time,
                $2::time AS end_time,
                $3::time AS open_time,
                $4::time AS close_time
            `,
            [
                start_time,
                end_time,
                businessHours.open_time,
                businessHours.close_time
            ]
        );

        const appointmentTimes = appointmentTimeResult.rows[0];

        if (
            appointmentTimes.start_time < appointmentTimes.open_time ||
            appointmentTimes.end_time > appointmentTimes.close_time
        ) {
            return res.status(400).json({
                error: 'The appointment time is outside business hours'
            });
        }

        // Update the appointment
        const updateResult = await pool.query(
            `
            UPDATE appointments
            SET
                appointment_date = $1,
                start_time = $2,
                end_time = $3
            WHERE id = $4
              AND status = 'scheduled'
            RETURNING *
            `,
            [
                appointment_date,
                start_time,
                end_time,
                id
            ]
        );

        res.json({
            message: 'Appointment rescheduled successfully',
            appointment: updateResult.rows[0]
        });

    } catch (error) {
        console.error('Error rescheduling appointment:', error);

        // PostgreSQL exclusion constraint
        // prevents overlapping appointments
        if (error.code === '23P01') {
            return res.status(409).json({
                error: 'That time slot is already booked'
            });
        }

        res.status(500).json({
            error: 'Failed to reschedule appointment'
        });
    }
});


// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});