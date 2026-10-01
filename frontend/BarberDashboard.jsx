import { useEffect, useState } from "react";

function BarberDashboard({ user }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);
  const [rescheduleTimeSlots, setRescheduleTimeSlots] = useState([]);
  const [rescheduleTime, setRescheduleTime] = useState("");

  useEffect(() => {
    const loadAppointments = async () => {
      try {
        const response = await fetch(
          "http://localhost:3001/api/barber/appointments",
          {
            credentials: "include",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load appointments.");
        }

        setAppointments(data);
      } catch (error) {
        console.error("Error loading appointments:", error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    loadAppointments();
  }, []);

  const cancelAppointment = async (appointmentId) => {
    const confirmed = window.confirm(
      "Are you sure you want to cancel this appointment?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/barber/appointments/${appointmentId}/cancel`,
        {
          method: "PUT",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel appointment.");
      }

      setAppointments((currentAppointments) =>
        currentAppointments.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                status: "cancelled",
              }
            : appointment
        )
      );
    } catch (error) {
      console.error("Cancel appointment error:", error);
      alert(error.message);
    }
  };

  const generateRescheduleTimeSlots = async (appointment, date) => {
    if (!date) {
      setRescheduleTimeSlots([]);
      setRescheduleTime("");
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/availability?date=${date}&barber_id=${appointment.barber_id}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load availability");
      }

      const businessHours = data.business_hours;

      if (!businessHours || businessHours.closed) {
        setRescheduleTimeSlots([]);
        setRescheduleTime("");
        return;
      }

      const serviceResponse = await fetch(`http://localhost:3001/api/services`);

      const servicesData = await serviceResponse.json();

      if (!serviceResponse.ok) {
        throw new Error(servicesData.error || "Failed to load services");
      }

      const service = servicesData.find(
        (service) => service.id === Number(appointment.service_id)
      );

      if (!service) {
        setRescheduleTimeSlots([]);
        setRescheduleTime("");
        return;
      }

      const duration = service.duration_minutes;
      const slots = [];

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

        const startTime =
          `${String(hours).padStart(2, "0")}:` +
          `${String(mins).padStart(2, "0")}`;

        const endMinutes = minutes + duration;

        const endHours = Math.floor(endMinutes / 60);
        const endMins = endMinutes % 60;

        const endTime =
          `${String(endHours).padStart(2, "0")}:` +
          `${String(endMins).padStart(2, "0")}`;

        const isBooked = data.appointments.some((existingAppointment) => {
          // Ignore the appointment
          // we're currently rescheduling.
          if (existingAppointment.id === appointment.id) {
            return false;
          }

          const appointmentStart = existingAppointment.start_time.substring(
            0,
            5
          );

          const appointmentEnd = existingAppointment.end_time.substring(0, 5);

          return startTime < appointmentEnd && endTime > appointmentStart;
        });

        if (!isBooked) {
          slots.push({
            startTime,
            endTime,
          });
        }
      }

      setRescheduleTimeSlots(slots);
    } catch (error) {
      console.error("Error loading reschedule availability:", error);

      setRescheduleTimeSlots([]);
      setRescheduleTime("");
    }
  };

  const rescheduleAppointment = async () => {
    if (!reschedulingAppointment) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to reschedule this appointment?"
    );

    if (!confirmed) {
      return;
    }

    const form = document.querySelector(".reschedule-form");

    const date = form.querySelector('input[type="date"]').value;
    const time = rescheduleTime;

    if (!date || !time) {
      alert("Please select a date and time.");
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/barber/appointments/${reschedulingAppointment.id}/reschedule`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            appointment_date: date,
            start_time: time,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reschedule appointment.");
      }

      setAppointments((currentAppointments) =>
        currentAppointments.map((appointment) =>
          appointment.id === reschedulingAppointment.id
            ? {
                ...appointment,
                appointment_date: date,
                start_time: time,
                end_time: data.appointment.end_time,
              }
            : appointment
        )
      );

      setReschedulingAppointment(null);

      alert("Appointment rescheduled successfully.");
    } catch (error) {
      console.error("Reschedule appointment error:", error);
      alert(error.message);
    }
  };

  const formatDate = (dateString) => {
    const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);

    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (timeString) => {
    const [hours, minutes] = timeString.slice(0, 5).split(":").map(Number);

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="admin-container">
      <div className="barber-dashboard-header">
        <div className="barber-dashboard-title">
          <h1>Barber Dashboard</h1>

          <p>
            Welcome back, <strong>{user.username}</strong>!
          </p>
        </div>

        <div className="barber-dashboard-actions">
          <button
            className="back-to-scheduler-button"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            ← Back to Scheduler
          </button>

          <button
            className="logout-button"
            onClick={async () => {
              try {
                await fetch("http://localhost:3001/api/auth/logout", {
                  method: "POST",
                  credentials: "include",
                });

                window.location.href = "/admin";
              } catch (error) {
                console.error("Logout error:", error);
              }
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      <div className="today-appointments-section">
        <div className="today-appointments-header">
          <div>
            <h2>Today's Appointments</h2>
            <p>
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          {!loading && !error && (
            <div className="today-appointment-count">
              {
                appointments.filter((appointment) => {
                  const appointmentDate = new Date(
                    appointment.appointment_date
                  ).toLocaleDateString("en-CA");

                  const today = new Date().toLocaleDateString("en-CA");

                  return (
                    appointmentDate === today &&
                    appointment.status !== "cancelled"
                  );
                }).length
              }{" "}
              {appointments.filter((appointment) => {
                const appointmentDate = new Date(
                  appointment.appointment_date
                ).toLocaleDateString("en-CA");

                const today = new Date().toLocaleDateString("en-CA");

                return (
                  appointmentDate === today &&
                  appointment.status !== "cancelled"
                );
              }).length === 1
                ? "appointment"
                : "appointments"}
            </div>
          )}
        </div>

        {!loading && !error && (
          <div className="today-appointments">
            {appointments.filter((appointment) => {
              const appointmentDate = new Date(
                appointment.appointment_date
              ).toLocaleDateString("en-CA");

              const today = new Date().toLocaleDateString("en-CA");

              return (
                appointmentDate === today && appointment.status !== "cancelled"
              );
            }).length === 0 ? (
              <div className="no-today-appointments">
                <div className="no-appointments-icon">✓</div>
                <strong>No appointments scheduled</strong>
                <span>Your schedule is clear for today.</span>
              </div>
            ) : (
              appointments
                .filter((appointment) => {
                  const appointmentDate = new Date(
                    appointment.appointment_date
                  ).toLocaleDateString("en-CA");

                  const today = new Date().toLocaleDateString("en-CA");

                  return (
                    appointmentDate === today &&
                    appointment.status !== "cancelled"
                  );
                })
                .sort((a, b) => a.start_time.localeCompare(b.start_time))
                .map((appointment) => (
                  <div key={appointment.id} className="today-appointment-card">
                    <div className="today-appointment-time">
                      <strong>{formatTime(appointment.start_time)}</strong>

                      <span>{formatTime(appointment.end_time)}</span>
                    </div>

                    <div className="today-appointment-divider"></div>

                    <div className="today-appointment-details">
                      <strong>{appointment.customer_name}</strong>

                      <span>{appointment.service}</span>
                    </div>

                    <div className="today-appointment-status">
                      <span className="today-scheduled-badge">Scheduled</span>
                    </div>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {reschedulingAppointment && (
        <div className="reschedule-panel">
          <h2>Reschedule Appointment</h2>

          <p>
            Rescheduling appointment for{" "}
            <strong>{reschedulingAppointment.customer_name}</strong>
          </p>

          <div className="reschedule-form">
            <label>
              New Date
              <input
                type="date"
                defaultValue={reschedulingAppointment.appointment_date.slice(
                  0,
                  10
                )}
                onChange={(event) => {
                  const newDate = event.target.value;

                  setRescheduleTime("");
                  generateRescheduleTimeSlots(reschedulingAppointment, newDate);
                }}
              />
            </label>

            <label>
              New Time
              <div className="reschedule-time-slots">
                {rescheduleTimeSlots.length === 0 ? (
                  <span className="no-reschedule-times">
                    No available times
                  </span>
                ) : (
                  rescheduleTimeSlots.map((slot) => (
                    <button
                      type="button"
                      key={slot.startTime}
                      className={
                        rescheduleTime === slot.startTime
                          ? "reschedule-time-slot selected"
                          : "reschedule-time-slot"
                      }
                      onClick={() => setRescheduleTime(slot.startTime)}
                    >
                      {formatTime(slot.startTime)}
                    </button>
                  ))
                )}
              </div>
            </label>

            <div className="reschedule-form-actions">
              <button
                type="button"
                className="save-reschedule-button"
                onClick={rescheduleAppointment}
              >
                Save Reschedule
              </button>

              <button
                type="button"
                className="cancel-reschedule-button"
                onClick={() => setReschedulingAppointment(null)}
              >
                Never Mind
              </button>
            </div>
          </div>
        </div>
      )}

      <h2>My Appointments</h2>

      {loading && <p>Loading appointments...</p>}

      {error && <p className="login-error">{error}</p>}

      {!loading && !error && appointments.length === 0 && (
        <p>No appointments found.</p>
      )}

      {!loading && !error && appointments.length > 0 && (
        <div className="appointments-table-wrapper">
          <table className="appointments-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Service</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {appointments.map((appointment) => (
                <tr
                  key={appointment.id}
                  className={
                    appointment.status === "cancelled"
                      ? "appointment-cancelled"
                      : ""
                  }
                >
                  <td>{formatDate(appointment.appointment_date)}</td>

                  <td>
                    <strong>{formatTime(appointment.start_time)}</strong>

                    {" – "}

                    {formatTime(appointment.end_time)}
                  </td>

                  <td>
                    <strong>{appointment.customer_name}</strong>
                  </td>

                  <td>{appointment.customer_phone || "-"}</td>

                  <td>{appointment.customer_email || "-"}</td>

                  <td>{appointment.service}</td>

                  <td>${appointment.price}</td>

                  <td>
                    <span
                      className={`appointment-status ${appointment.status}`}
                    >
                      {appointment.status === "scheduled"
                        ? "Scheduled"
                        : "Cancelled"}
                    </span>
                  </td>
                  <td>
                    {appointment.status === "scheduled" && (
                      <div className="appointment-actions">
                        <button
                          className="reschedule-appointment-button"
                          onClick={() => {
                            setReschedulingAppointment(appointment);

                            generateRescheduleTimeSlots(
                              appointment,
                              appointment.appointment_date.slice(0, 10)
                            );

                            setRescheduleTime(
                              appointment.start_time.substring(0, 5)
                            );
                          }}
                        >
                          Reschedule
                        </button>

                        <button
                          className="cancel-appointment-button"
                          onClick={() => cancelAppointment(appointment.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BarberDashboard;
