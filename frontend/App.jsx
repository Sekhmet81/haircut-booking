import { useEffect, useState } from "react";
import Admin from "./Admin";
import BarberDashboard from "./BarberDashboard";
import Login from "./Login";
import ManageAppointment from "./ManageAppointment";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    if (window.location.pathname !== "/admin") {
      setCheckingAuth(false);
      return;
    }

    fetch("http://localhost:3001/api/auth/me", {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Not logged in");
        }

        return response.json();
      })
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  if (window.location.pathname.startsWith("/manage-appointment/")) {
    return <ManageAppointment />;
  }

  if (window.location.pathname === "/admin") {
    if (checkingAuth) {
      return <div>Checking login...</div>;
    }

    if (!user) {
      return <Login onLogin={setUser} />;
    }

    if (user.role === "admin") {
      return <Admin />;
    }

    if (user.role === "barber") {
      return <BarberDashboard user={user} />;
    }

    return <div>Access denied.</div>;
  }

  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);

  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingConfirmation, setBookingConfirmation] = useState(null);

  const [selectedService, setSelectedService] = useState("");
  const [selectedBarber, setSelectedBarber] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const [appointments, setAppointments] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);

  const [step, setStep] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState("");

  // ============================================
  // LOAD SERVICES AND BARBERS
  // ============================================

  useEffect(() => {
    async function loadData() {
      try {
        const servicesResponse = await fetch(
          "http://localhost:3001/api/services"
        );

        const barbersResponse = await fetch(
          "http://localhost:3001/api/barbers"
        );

        if (!servicesResponse.ok || !barbersResponse.ok) {
          throw new Error("Failed to load data");
        }

        const servicesData = await servicesResponse.json();

        const barbersData = await barbersResponse.json();

        setServices(servicesData);
        setBarbers(barbersData);
      } catch (error) {
        console.error(error);

        setError("Unable to connect to the booking server.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // ============================================
  // LOAD AVAILABILITY
  // ============================================

  async function loadAvailability(date = selectedDate) {
    setLoadingSlots(true);
    setSelectedTime("");

    try {
      const response = await fetch(
        `http://localhost:3001/api/availability?date=${date}&barber_id=${selectedBarber}`
      );

      if (!response.ok) {
        throw new Error("Failed to load availability");
      }

      const data = await response.json();

      // Store the appointments
      setAppointments(data.appointments);

      // Generate time slots using the appointments
      // and the business hours from the database
      generateTimeSlots(data.appointments, data.business_hours);
    } catch (error) {
      console.error(error);

      setError("Unable to load available times.");
    } finally {
      setLoadingSlots(false);
    }
  }

  // ============================================
  // GENERATE TIME SLOTS
  // ============================================

  function generateTimeSlots(existingAppointments, businessHours) {
    const service = services.find(
      (service) => service.id === Number(selectedService)
    );

    if (!service || !businessHours) {
      setTimeSlots([]);
      return;
    }

    // If the shop is closed, there are no available times
    if (businessHours.closed) {
      setTimeSlots([]);
      return;
    }

    const duration = service.duration_minutes;

    const slots = [];

    // Convert database times like "09:00:00" into minutes
    const [openHour, openMinute] = businessHours.open_time
      .substring(0, 5)
      .split(":")
      .map(Number);

    const [closeHour, closeMinute] = businessHours.close_time
      .substring(0, 5)
      .split(":")
      .map(Number);

    const openingMinutes = openHour * 60 + openMinute;
    const closingMinutes = closeHour * 60 + closeMinute;

    for (
      let minutes = openingMinutes;
      minutes + duration <= closingMinutes;
      minutes += 30
    ) {
      const hours = Math.floor(minutes / 60);

      const mins = minutes % 60;

      const startTime = `${String(hours).padStart(2, "0")}:${String(
        mins
      ).padStart(2, "0")}`;

      const endMinutes = minutes + duration;

      const endHours = Math.floor(endMinutes / 60);

      const endMins = endMinutes % 60;

      const endTime = `${String(endHours).padStart(2, "0")}:${String(
        endMins
      ).padStart(2, "0")}`;

      const isBooked = existingAppointments.some((appointment) => {
        const appointmentStart = appointment.start_time.substring(0, 5);

        const appointmentEnd = appointment.end_time.substring(0, 5);

        return startTime < appointmentEnd && endTime > appointmentStart;
      });

      if (!isBooked) {
        slots.push({
          startTime,
          endTime,
        });
      }
    }

    setTimeSlots(slots);
  }

  // ============================================
  // DATE CONTINUE
  // ============================================

  function handleDateContinue() {
    if (!selectedDate) {
      return;
    }

    loadAvailability();
  }

  // ============================================
  // GET SELECTED SERVICE
  // ============================================

  const selectedServiceInfo = services.find(
    (service) => service.id === Number(selectedService)
  );

  // ============================================
  // GET SELECTED BARBER
  // ============================================

  const selectedBarberInfo = barbers.find(
    (barber) => barber.id === Number(selectedBarber)
  );

  // ============================================
  // Handle Booking
  // ============================================

  const handleBooking = async () => {
    setBooking(true);
    setBookingError("");

    try {
      const response = await fetch("http://localhost:3001/api/appointments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          barber_id: Number(selectedBarber),
          service_id: Number(selectedService),
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || null,
          customer_email: customerEmail.trim() || null,
          appointment_date: selectedDate,
          start_time: selectedTime,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        setBookingError(
          "That time was just booked by someone else. Please choose another time."
        );
        setStep(3);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Unable to book appointment.");
      }

      setBookingConfirmation(data.appointment);
      setStep(4);
    } catch (error) {
      console.error("Booking error:", error);
      setBookingError(error.message);
    } finally {
      setBooking(false);
    }
  };

  // ============================================
  // LOADING
  // ============================================

  if (loading) {
    return <h2>Loading...</h2>;
  }

  if (error) {
    return <h2>{error}</h2>;
  }

  return (
    <div className="app">
      <header>
        <h1>Haircut Booking</h1>

        <p>Book your next haircut</p>

        <button
          className="login-link"
          onClick={() => {
            window.location.href = "/admin";
          }}
        >
          Admin / Barber Login
        </button>
      </header>

      <main>
        <section className="booking-card">
          {/* ================================= */}
          {/* STEP 1 */}
          {/* ================================= */}

          {step === 1 && (
            <>
              <h2>Book an Appointment</h2>

              <div className="form-group">
                <label>Haircut Service</label>

                <select
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                >
                  <option value="">Select a service...</option>

                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                      {" - "}${service.price}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Barber</label>

                <select
                  value={selectedBarber}
                  onChange={(e) => setSelectedBarber(e.target.value)}
                >
                  <option value="">Select a barber...</option>

                  {barbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="continue-button"
                disabled={!selectedService || !selectedBarber}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </>
          )}

          {/* ================================= */}
          {/* STEP 2 */}
          {/* ================================= */}

          {step === 2 && (
            <>
              <h2>Select a Date & Time</h2>

              <div className="form-group">
                <label>Appointment Date</label>

                <input
                  type="date"
                  value={selectedDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => {
                    const newDate = e.target.value;

                    setSelectedDate(newDate);
                    setSelectedTime("");

                    if (newDate) {
                      loadAvailability(newDate);
                    }
                  }}
                />
              </div>

              {selectedDate && (
                <>
                  <h3>Available Times</h3>

                  {loadingSlots ? (
                    <p>Loading available times...</p>
                  ) : (
                    <div className="time-slots">
                      {timeSlots.length === 0 ? (
                        <p>No available times for this date.</p>
                      ) : (
                        timeSlots.map((slot) => (
                          <button
                            type="button"
                            key={slot.startTime}
                            className={
                              selectedTime === slot.startTime
                                ? "time-slot selected"
                                : "time-slot"
                            }
                            onClick={() => setSelectedTime(slot.startTime)}
                          >
                            {formatTime(slot.startTime)}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              <button
                className="continue-button"
                disabled={!selectedTime}
                onClick={() => setStep(3)}
              >
                Continue
              </button>

              <button className="back-button" onClick={() => setStep(1)}>
                Back
              </button>
            </>
          )}

          {/* ================================= */}
          {/* STEP 3 */}
          {/* ================================= */}

          {step === 3 && (
            <>
              <h2>Your Information</h2>

              {/* BOOKING SUMMARY */}

              <div className="booking-summary">
                <h3>Appointment Summary</h3>

                <p>
                  <strong>Service:</strong> {selectedServiceInfo?.name}
                </p>

                <p>
                  <strong>Barber:</strong> {selectedBarberInfo?.name}
                </p>

                <p>
                  <strong>Date:</strong> {selectedDate}
                </p>

                <p>
                  <strong>Time:</strong> {formatTime(selectedTime)}
                </p>

                <p>
                  <strong>Price:</strong> ${selectedServiceInfo?.price}
                </p>
              </div>

              {/* CUSTOMER NAME */}

              <div className="form-group">
                <label>Name *</label>

                <input
                  type="text"
                  value={customerName}
                  placeholder="Your name"
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              {/* PHONE */}

              <div className="form-group">
                <label>Phone</label>

                <input
                  type="tel"
                  value={customerPhone}
                  placeholder="555-123-4567"
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>

              {/* EMAIL */}

              <div className="form-group">
                <label>Email</label>

                <input
                  type="email"
                  value={customerEmail}
                  placeholder="you@example.com"
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </div>

              <button
                className="book-appointment-button"
                onClick={handleBooking}
                disabled={booking || !customerName.trim()}
              >
                {booking ? "Booking..." : "Book Appointment"}
              </button>

              {bookingError && <p className="error-message">{bookingError}</p>}

              <button className="back-button" onClick={() => setStep(2)}>
                Back
              </button>
            </>
          )}
          {step === 4 && bookingConfirmation && (
            <div className="card confirmation-card">
              <h2>Appointment Booked! 🎉</h2>

              <p className="confirmation-message">
                Your haircut has been successfully booked.
              </p>

              <div className="booking-summary">
                <p>
                  <strong>Service:</strong>{" "}
                  {services.find((s) => s.id === Number(selectedService))?.name}
                </p>

                <p>
                  <strong>Barber:</strong>{" "}
                  {barbers.find((b) => b.id === Number(selectedBarber))?.name}
                </p>

                <p>
                  <strong>Date:</strong> {selectedDate}
                </p>

                <p>
                  <strong>Time:</strong> {formatTime(selectedTime)}
                </p>

                <p>
                  <strong>Name:</strong> {customerName}
                </p>

                {customerPhone && (
                  <p>
                    <strong>Phone:</strong> {customerPhone}
                  </p>
                )}

                {customerEmail && (
                  <p>
                    <strong>Email:</strong> {customerEmail}
                  </p>
                )}
              </div>

              <p>
                <strong>Confirmation #:</strong> {bookingConfirmation.id}
              </p>

              <button
                className="book-another-button"
                onClick={() => {
                  setStep(1);
                  setSelectedService("");
                  setSelectedBarber("");
                  setSelectedDate("");
                  setSelectedTime("");
                  setCustomerName("");
                  setCustomerPhone("");
                  setCustomerEmail("");
                  setBookingConfirmation(null);
                  setBookingError("");
                }}
              >
                Book Another Appointment
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ============================================
// FORMAT TIME
// ============================================

function formatTime(time) {
  const [hours, minutes] = time.split(":");

  const date = new Date();

  date.setHours(Number(hours), Number(minutes));

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default App;
