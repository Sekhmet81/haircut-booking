import { useEffect, useState } from "react";

function generateAvailableSlots(
  availability,
  serviceDuration,
  currentAppointmentId
) {
  if (!availability || !availability.business_hours) {
    return [];
  }

  const businessHours = availability.business_hours;

  if (businessHours.closed) {
    return [];
  }

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

  const slots = [];

  for (
    let startMinutes = openingMinutes;
    startMinutes + serviceDuration <= closingMinutes;
    startMinutes += 30
  ) {
    const endMinutes = startMinutes + serviceDuration;

    const overlaps = availability.appointments.some((appointment) => {
      // Don't let the appointment block itself
      if (appointment.id === currentAppointmentId) {
        return false;
      }

      const [appointmentHour, appointmentMinute] = appointment.start_time
        .substring(0, 5)
        .split(":")
        .map(Number);

      const [appointmentEndHour, appointmentEndMinute] = appointment.end_time
        .substring(0, 5)
        .split(":")
        .map(Number);

      const appointmentStartMinutes = appointmentHour * 60 + appointmentMinute;

      const appointmentEndMinutes =
        appointmentEndHour * 60 + appointmentEndMinute;

      return (
        startMinutes < appointmentEndMinutes &&
        endMinutes > appointmentStartMinutes
      );
    });

    if (!overlaps) {
      const hour = Math.floor(startMinutes / 60);
      const minute = startMinutes % 60;

      const time =
        `${String(hour).padStart(2, "0")}:` +
        `${String(minute).padStart(2, "0")}`;

      slots.push(time);
    }
  }

  return slots;
}

function ManageAppointment() {
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [availability, setAvailability] = useState(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [newTime, setNewTime] = useState("");
  const availableSlots =
    appointment && availability
      ? generateAvailableSlots(
          availability,
          appointment.service_duration,
          appointment.id
        )
      : [];

  useEffect(() => {
    async function loadAppointment() {
      try {
        const token = window.location.pathname.split("/").pop();

        const response = await fetch(
          `http://localhost:3001/api/appointments/manage/${token}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to load appointment.");
        }

        setAppointment(data);
      } catch (error) {
        console.error(error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    }

    loadAppointment();
  }, []);

  if (loading) {
    return <h2>Loading appointment...</h2>;
  }

  if (error) {
    return <h2>{error}</h2>;
  }

  return (
    <div className="app">
      <header>
        <h1>Manage Appointment</h1>
        <p>View your appointment details</p>
      </header>

      <main>
        <section className="booking-card manage-appointment-card">
          <h2>Appointment Details</h2>

          <div className="booking-summary">
            <p>
              <strong>Service:</strong> {appointment.service_name}
            </p>

            <p>
              <strong>Barber:</strong> {appointment.barber_name}
            </p>

            <p>
              <strong>Date:</strong>{" "}
              {new Date(appointment.appointment_date).toLocaleDateString(
                "en-US",
                {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }
              )}
            </p>

            <p>
              <strong>Time:</strong> {formatTime(appointment.start_time)}
            </p>

            <p>
              <strong>Status:</strong>{" "}
              <span className={`manage-status ${appointment.status}`}>
                {appointment.status}
              </span>
            </p>
          </div>

          {appointment.status === "cancelled" ? (
            <div>
              <div className="cancelled-message">
                <p>
                  <strong>This appointment has been cancelled.</strong>
                </p>
              </div>

              <button
                className="continue-button"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                Book Another Appointment
              </button>
            </div>
          ) : (
            <div>
              <button
                className="continue-button"
                onClick={() => setRescheduling(true)}
              >
                Reschedule Appointment
              </button>

              <button
                className="back-button"
                onClick={async () => {
                  const confirmed = window.confirm(
                    "Are you sure you want to cancel this appointment?"
                  );

                  if (!confirmed) {
                    return;
                  }

                  try {
                    setError("");

                    const token = window.location.pathname.split("/").pop();

                    const response = await fetch(
                      `http://localhost:3001/api/appointments/manage/${token}/cancel`,
                      {
                        method: "PUT",
                      }
                    );

                    const data = await response.json();

                    if (!response.ok) {
                      throw new Error(
                        data.error || "Unable to cancel appointment."
                      );
                    }

                    setAppointment({
                      ...appointment,
                      ...data.appointment,
                    });

                    setRescheduling(false);

                    alert("Appointment cancelled successfully!");
                  } catch (error) {
                    console.error(error);
                    setError(error.message);
                  }
                }}
              >
                Cancel Appointment
              </button>
            </div>
          )}

          {rescheduling && (
            <div className="reschedule-section">
              <h3>Reschedule Appointment</h3>

              <label>Choose a new date:</label>

              <input
                type="date"
                min={new Date().toISOString().split("T")[0]}
                value={newDate}
                onChange={async (event) => {
                  const selectedDate = event.target.value;

                  setNewDate(selectedDate);
                  setAvailability(null);

                  if (!selectedDate) {
                    return;
                  }

                  setLoadingTimes(true);

                  try {
                    const response = await fetch(
                      `http://localhost:3001/api/availability?date=${selectedDate}&barber_id=${appointment.barber_id}`
                    );

                    const data = await response.json();

                    if (!response.ok) {
                      throw new Error(
                        data.error || "Unable to load available times."
                      );
                    }

                    setAvailability(data);
                  } catch (error) {
                    console.error(error);
                    setError(error.message);
                  } finally {
                    setLoadingTimes(false);
                  }
                }}
              />

              {loadingTimes && <p>Loading available times...</p>}
              {!loadingTimes && newDate && (
                <div className="time-selection">
                  <h4>Choose a new time:</h4>

                  {availableSlots.length === 0 ? (
                    <p>No available times for this date.</p>
                  ) : (
                    availableSlots.map((time) => (
                      <button
                        key={time}
                        type="button"
                        className={
                          newTime === time ? "continue-button" : "back-button"
                        }
                        onClick={() => setNewTime(time)}
                      >
                        {formatTime(time)}
                      </button>
                    ))
                  )}

                  {newTime && (
                    <button
                      type="button"
                      className="continue-button"
                      onClick={async () => {
                        try {
                          setError("");

                          const token = window.location.pathname
                            .split("/")
                            .pop();

                          const response = await fetch(
                            `http://localhost:3001/api/appointments/manage/${token}/reschedule`,
                            {
                              method: "PUT",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                appointment_date: newDate,
                                start_time: newTime,
                              }),
                            }
                          );

                          const data = await response.json();

                          if (!response.ok) {
                            throw new Error(
                              data.error || "Unable to reschedule appointment."
                            );
                          }

                          setAppointment({
                            ...appointment,
                            ...data.appointment,
                          });

                          setRescheduling(false);
                          setNewTime("");

                          alert("Appointment rescheduled successfully!");
                        } catch (error) {
                          console.error(error);
                          setError(error.message);
                        }
                      }}
                    >
                      Confirm Reschedule
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function formatTime(time) {
  const [hours, minutes] = time.split(":");

  const date = new Date();

  date.setHours(Number(hours), Number(minutes));

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default ManageAppointment;
