import { useEffect, useState } from "react";

function Admin() {
  const [activeTab, setActiveTab] = useState("barbers");

  // =========================
  // BARBERS
  // =========================

  const [barbers, setBarbers] = useState([]);
  const [barberName, setBarberName] = useState("");
  const [editingBarberId, setEditingBarberId] = useState(null);
  const [editingBarberName, setEditingBarberName] = useState("");

  // =========================
  // SERVICES
  // =========================

  const [services, setServices] = useState([]);
  const [serviceName, setServiceName] = useState("");
  const [serviceDuration, setServiceDuration] = useState("");
  const [servicePrice, setServicePrice] = useState("");

  const [editingServiceId, setEditingServiceId] = useState(null);
  const [editingServiceName, setEditingServiceName] = useState("");
  const [editingServiceDuration, setEditingServiceDuration] = useState("");
  const [editingServicePrice, setEditingServicePrice] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [businessHours, setBusinessHours] = useState([]);
  const [savedDay, setSavedDay] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [appointmentDate, setAppointmentDate] = useState("");

  const [reschedulingAppointmentId, setReschedulingAppointmentId] =
    useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleTimeSlots, setRescheduleTimeSlots] = useState([]);

  // =========================
  // LOAD BARBERS
  // =========================

  const loadBarbers = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/admin/barbers", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load barbers");
      }

      const data = await response.json();
      setBarbers(data);
    } catch (error) {
      console.error(error);
      setError("Failed to load barbers");
    }
  };

  // =========================
  // LOAD SERVICES
  // =========================

  const loadServices = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/admin/services", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load services");
      }

      const data = await response.json();
      setServices(data);
    } catch (error) {
      console.error(error);
      setError("Failed to load services");
    }
  };

  // =========================
  // LOAD HOURS
  // =========================

  const loadBusinessHours = async () => {
    try {
      const response = await fetch(
        "http://localhost:3001/api/admin/business-hours",
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to load business hours");
      }

      const data = await response.json();
      setBusinessHours(data);
    } catch (error) {
      console.error("Error loading business hours:", error);
    }
  };

  const loadAppointments = async () => {
    try {
      const response = await fetch(
        "http://localhost:3001/api/admin/appointments",
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to load appointments");
      }

      const data = await response.json();

      setAppointments(data);
    } catch (error) {
      console.error("Error loading appointments:", error);
    }
  };

  const cancelAppointment = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to cancel this appointment?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/admin/appointments/${id}/cancel`,
        {
          method: "PUT",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel appointment");
      }

      // Update the appointment in the current list
      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.id === id
            ? {
                ...appointment,
                status: "cancelled",
              }
            : appointment
        )
      );
    } catch (error) {
      console.error("Error cancelling appointment:", error);

      alert(error.message);
    }
  };

  const generateRescheduleTimeSlots = async (appointment, date) => {
    if (!date) {
      setRescheduleTimeSlots([]);
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
        return;
      }

      const service = services.find(
        (service) => service.id === Number(appointment.service_id)
      );

      if (!service) {
        setRescheduleTimeSlots([]);
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

        const startTime = `${String(hours).padStart(2, "0")}:${String(
          mins
        ).padStart(2, "0")}`;

        const endMinutes = minutes + duration;
        const endHours = Math.floor(endMinutes / 60);
        const endMins = endMinutes % 60;

        const endTime = `${String(endHours).padStart(2, "0")}:${String(
          endMins
        ).padStart(2, "0")}`;

        const isBooked = data.appointments.some((existingAppointment) => {
          // Ignore the appointment we're currently rescheduling.
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
    }
  };

  const formatTime = (time) => {
    const [hour, minute] = time.split(":");
    const hourNumber = Number(hour);

    const period = hourNumber >= 12 ? "PM" : "AM";
    const displayHour = hourNumber % 12 || 12;

    return `${displayHour}:${minute} ${period}`;
  };

  const rescheduleAppointment = async (id) => {
    if (!rescheduleDate || !rescheduleTime) {
      alert("Please select a new date and time.");
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/api/admin/appointments/${id}/reschedule`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            appointment_date: rescheduleDate,
            start_time: rescheduleTime,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reschedule appointment");
      }

      // Update the appointment in the current list
      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.id === id
            ? {
                ...appointment,
                appointment_date: data.appointment.appointment_date,
                start_time: data.appointment.start_time,
                end_time: data.appointment.end_time,
              }
            : appointment
        )
      );

      // Close the reschedule form
      setReschedulingAppointmentId(null);
      setRescheduleDate("");
      setRescheduleTime("");
    } catch (error) {
      console.error("Error rescheduling appointment:", error);

      alert(error.message);
    }
  };

  // =========================
  // INITIAL LOAD
  // =========================

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      await Promise.all([
        loadBarbers(),
        loadServices(),
        loadBusinessHours(),
        loadAppointments(),
      ]);

      setLoading(false);
    };

    loadData();
  }, []);

  // =========================
  // ADD BARBER
  // =========================

  const addBarber = async (event) => {
    event.preventDefault();

    if (!barberName.trim()) {
      return;
    }

    try {
      const response = await fetch("http://localhost:3001/api/admin/barbers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name: barberName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add barber");
      }

      setBarbers([...barbers, data]);
      setBarberName("");
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // SAVE BARBER
  // =========================

  const saveBarber = async (id) => {
    if (!editingBarberName.trim()) {
      return;
    }

    const barber = barbers.find((b) => b.id === id);

    try {
      const response = await fetch(
        `http://localhost:3001/api/admin/barbers/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: editingBarberName.trim(),
            active: barber.active,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update barber");
      }

      setBarbers(barbers.map((b) => (b.id === id ? data : b)));

      setEditingBarberId(null);
      setEditingBarberName("");
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // TOGGLE BARBER
  // =========================

  const toggleBarber = async (barber) => {
    try {
      const response = await fetch(
        `http://localhost:3001/api/admin/barbers/${barber.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: barber.name,
            active: !barber.active,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update barber");
      }

      setBarbers(barbers.map((b) => (b.id === barber.id ? data : b)));
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // ADD SERVICE
  // =========================

  const addService = async (event) => {
    event.preventDefault();

    if (!serviceName.trim()) {
      setError("Service name is required");
      return;
    }

    if (!serviceDuration || Number(serviceDuration) <= 0) {
      setError("Duration must be greater than 0");
      return;
    }

    if (servicePrice === "" || Number(servicePrice) < 0) {
      setError("Price must be 0 or greater");
      return;
    }

    try {
      setError("");

      const response = await fetch("http://localhost:3001/api/admin/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name: serviceName.trim(),
          duration_minutes: Number(serviceDuration),
          price: Number(servicePrice),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add service");
      }

      setServices([...services, data]);

      setServiceName("");
      setServiceDuration("");
      setServicePrice("");
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // SAVE SERVICE
  // =========================

  const saveService = async (id) => {
    if (!editingServiceName.trim()) {
      setError("Service name is required");
      return;
    }

    if (!editingServiceDuration || Number(editingServiceDuration) <= 0) {
      setError("Duration must be greater than 0");
      return;
    }

    if (editingServicePrice === "" || Number(editingServicePrice) < 0) {
      setError("Price must be 0 or greater");
      return;
    }

    const service = services.find((s) => s.id === id);

    try {
      setError("");

      const response = await fetch(
        `http://localhost:3001/api/admin/services/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: editingServiceName.trim(),
            duration_minutes: Number(editingServiceDuration),
            price: Number(editingServicePrice),
            active: service.active,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update service");
      }

      setServices(services.map((s) => (s.id === id ? data : s)));

      setEditingServiceId(null);
      setEditingServiceName("");
      setEditingServiceDuration("");
      setEditingServicePrice("");
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // TOGGLE SERVICE
  // =========================

  const toggleService = async (service) => {
    try {
      setError("");

      const response = await fetch(
        `http://localhost:3001/api/admin/services/${service.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: service.name,
            duration_minutes: service.duration_minutes,
            price: Number(service.price),
            active: !service.active,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update service");
      }

      setServices(services.map((s) => (s.id === service.id ? data : s)));
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
  };

  // =========================
  // Save Hours
  // =========================

  const saveBusinessHours = async (day) => {
    try {
      const response = await fetch(
        `http://localhost:3001/api/admin/business-hours/${day.day_of_week}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            open_time: day.open_time.slice(0, 5),
            close_time: day.close_time.slice(0, 5),
            closed: day.closed,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save business hours");
      }

      const updatedDay = await response.json();

      setBusinessHours((prev) =>
        prev.map((item) =>
          item.day_of_week === updatedDay.day_of_week ? updatedDay : item
        )
      );

      setSavedDay(day.day_of_week);

      setTimeout(() => {
        setSavedDay(null);
      }, 2000);
    } catch (error) {
      console.error("Error saving business hours:", error);
      alert(error.message);
    }
  };

  if (loading) {
    return <p>Loading admin dashboard...</p>;
  }

  return (
    <div className="admin-container">
      <h1>Admin Dashboard</h1>

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

      {/* =========================
                TABS
            ========================= */}

      <div className="admin-tabs">
        <button
          className={activeTab === "barbers" ? "active-tab" : ""}
          onClick={() => {
            setActiveTab("barbers");
            setError("");
          }}
        >
          Barbers
        </button>

        <button
          className={activeTab === "services" ? "active-tab" : ""}
          onClick={() => {
            setActiveTab("services");
            setError("");
          }}
        >
          Services
        </button>

        <button
          className={activeTab === "hours" ? "active-tab" : ""}
          onClick={() => {
            setActiveTab("hours");
            setError("");
          }}
        >
          Business Hours
        </button>
        <button
          className={activeTab === "appointments" ? "active-tab" : ""}
          onClick={() => setActiveTab("appointments")}
        >
          Appointments
        </button>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {/* =========================
                BARBERS TAB
            ========================= */}

      {activeTab === "barbers" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>Barbers</h2>
          </div>

          <form className="add-barber-form" onSubmit={addBarber}>
            <input
              type="text"
              placeholder="Barber name"
              value={barberName}
              onChange={(event) => setBarberName(event.target.value)}
            />

            <button type="submit">Add Barber</button>
          </form>

          <div className="barber-list">
            {barbers.map((barber) => (
              <div className="barber-row" key={barber.id}>
                {editingBarberId === barber.id ? (
                  <div className="barber-edit">
                    <input
                      type="text"
                      value={editingBarberName}
                      onChange={(event) =>
                        setEditingBarberName(event.target.value)
                      }
                      autoFocus
                    />

                    <button onClick={() => saveBarber(barber.id)}>Save</button>

                    <button
                      onClick={() => {
                        setEditingBarberId(null);
                        setEditingBarberName("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="barber-info">
                      <strong>{barber.name}</strong>

                      <span
                        className={
                          barber.active ? "status active" : "status inactive"
                        }
                      >
                        {barber.active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="barber-actions">
                      <button
                        onClick={() => {
                          setEditingBarberId(barber.id);
                          setEditingBarberName(barber.name);
                        }}
                      >
                        Edit
                      </button>

                      <button onClick={() => toggleBarber(barber)}>
                        {barber.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================
                SERVICES TAB
            ========================= */}

      {activeTab === "services" && (
        <div className="admin-card">
          <div className="admin-card-header">
            <h2>Services</h2>
          </div>

          <form className="add-service-form" onSubmit={addService}>
            <input
              type="text"
              placeholder="Service name"
              value={serviceName}
              onChange={(event) => setServiceName(event.target.value)}
            />

            <input
              type="number"
              placeholder="Duration"
              min="1"
              value={serviceDuration}
              onChange={(event) => setServiceDuration(event.target.value)}
            />

            <input
              type="number"
              placeholder="Price"
              min="0"
              step="0.01"
              value={servicePrice}
              onChange={(event) => setServicePrice(event.target.value)}
            />

            <button type="submit">Add Service</button>
          </form>

          <div className="service-list">
            {services.map((service) => (
              <div className="service-row" key={service.id}>
                {editingServiceId === service.id ? (
                  <div className="service-edit">
                    <input
                      type="text"
                      value={editingServiceName}
                      onChange={(event) =>
                        setEditingServiceName(event.target.value)
                      }
                    />

                    <input
                      type="number"
                      min="1"
                      value={editingServiceDuration}
                      onChange={(event) =>
                        setEditingServiceDuration(event.target.value)
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingServicePrice}
                      onChange={(event) =>
                        setEditingServicePrice(event.target.value)
                      }
                    />

                    <button onClick={() => saveService(service.id)}>
                      Save
                    </button>

                    <button
                      onClick={() => {
                        setEditingServiceId(null);
                        setEditingServiceName("");
                        setEditingServiceDuration("");
                        setEditingServicePrice("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="service-info">
                      <div>
                        <strong>{service.name}</strong>

                        <span>{service.duration_minutes} minutes</span>
                      </div>

                      <div>
                        <strong>${Number(service.price).toFixed(2)}</strong>

                        <span
                          className={
                            service.active ? "status active" : "status inactive"
                          }
                        >
                          {service.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>

                    <div className="service-actions">
                      <button
                        onClick={() => {
                          setEditingServiceId(service.id);
                          setEditingServiceName(service.name);
                          setEditingServiceDuration(service.duration_minutes);
                          setEditingServicePrice(service.price);
                        }}
                      >
                        Edit
                      </button>

                      <button onClick={() => toggleService(service)}>
                        {service.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================
                BUSINESS HOURS
            ========================= */}

      {activeTab === "hours" && (
        <div className="admin-card">
          <h2>Business Hours</h2>

          <p className="admin-description">
            Set the hours your shop is open each day.
          </p>

          <div className="hours-list">
            {businessHours.map((day) => {
              const dayNames = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ];

              return (
                <div className="hours-row" key={day.day_of_week}>
                  <div className="hours-day">
                    <strong>{dayNames[day.day_of_week]}</strong>
                  </div>

                  <div className="hours-controls">
                    <label>
                      Open
                      <input
                        type="time"
                        value={day.open_time.slice(0, 5)}
                        disabled={day.closed}
                        onChange={(e) => {
                          setBusinessHours((prev) =>
                            prev.map((item) =>
                              item.day_of_week === day.day_of_week
                                ? {
                                    ...item,
                                    open_time: e.target.value,
                                  }
                                : item
                            )
                          );
                        }}
                      />
                    </label>

                    <label>
                      Close
                      <input
                        type="time"
                        value={day.close_time.slice(0, 5)}
                        disabled={day.closed}
                        onChange={(e) => {
                          setBusinessHours((prev) =>
                            prev.map((item) =>
                              item.day_of_week === day.day_of_week
                                ? {
                                    ...item,
                                    close_time: e.target.value,
                                  }
                                : item
                            )
                          );
                        }}
                      />
                    </label>

                    <label className="closed-checkbox">
                      <input
                        type="checkbox"
                        checked={day.closed}
                        onChange={(e) => {
                          setBusinessHours((prev) =>
                            prev.map((item) =>
                              item.day_of_week === day.day_of_week
                                ? {
                                    ...item,
                                    closed: e.target.checked,
                                  }
                                : item
                            )
                          );
                        }}
                      />
                      Closed
                    </label>

                    <button
                      className="save-hours-button"
                      onClick={() => saveBusinessHours(day)}
                    >
                      Save
                    </button>

                    {savedDay === day.day_of_week && (
                      <span className="saved-message">Saved!</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================
                APPOINTMENTS
            ========================= */}

      {activeTab === "appointments" && (
        <div className="admin-card">
          <h2>Appointments</h2>

          <div className="appointment-filter">
            <label>
              View Date
              <input
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </label>

            <button onClick={() => setAppointmentDate("")}>Show All</button>
          </div>

          <div className="appointment-list">
            {appointments
              .filter(
                (appointment) =>
                  !appointmentDate ||
                  appointment.appointment_date.substring(0, 10) ===
                    appointmentDate
              )
              .map((appointment) => {
                const startTime = appointment.start_time.substring(0, 5);
                const endTime = appointment.end_time.substring(0, 5);

                return (
                  <div className="appointment-row" key={appointment.id}>
                    <div className="appointment-date">
                      <strong>
                        {appointment.appointment_date.substring(0, 10)}
                      </strong>

                      <span>
                        {startTime} - {endTime}
                      </span>
                    </div>

                    <div className="appointment-customer">
                      <strong>{appointment.customer_name}</strong>

                      {appointment.customer_phone && (
                        <span>{appointment.customer_phone}</span>
                      )}

                      {appointment.customer_email && (
                        <span>{appointment.customer_email}</span>
                      )}
                    </div>

                    <div className="appointment-service">
                      <strong>{appointment.service}</strong>

                      <span>Barber: {appointment.barber}</span>

                      <span>${Number(appointment.price).toFixed(2)}</span>

                      <span
                        className={`appointment-status ${appointment.status}`}
                      >
                        {appointment.status === "cancelled"
                          ? "Cancelled"
                          : "Scheduled"}
                      </span>

                      {appointment.status === "scheduled" && (
                        <>
                          <button
                            className="reschedule-appointment-button"
                            onClick={() => {
                              setReschedulingAppointmentId(appointment.id);

                              const currentDate =
                                appointment.appointment_date.substring(0, 10);

                              setRescheduleDate(currentDate);

                              setRescheduleTime(
                                appointment.start_time.substring(0, 5)
                              );

                              generateRescheduleTimeSlots(
                                appointment,
                                currentDate
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
                        </>
                      )}
                      {reschedulingAppointmentId === appointment.id && (
                        <div className="reschedule-form">
                          <label>
                            New Date
                            <input
                              type="date"
                              value={rescheduleDate}
                              onChange={(e) => {
                                const newDate = e.target.value;

                                setRescheduleDate(newDate);
                                setRescheduleTime("");

                                const appointment = appointments.find(
                                  (appointment) =>
                                    appointment.id === reschedulingAppointmentId
                                );

                                if (appointment) {
                                  generateRescheduleTimeSlots(
                                    appointment,
                                    newDate
                                  );
                                }
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
                                    onClick={() =>
                                      setRescheduleTime(slot.startTime)
                                    }
                                  >
                                    {formatTime(slot.startTime)}
                                  </button>
                                ))
                              )}
                            </div>
                          </label>

                          <div className="reschedule-actions">
                            <button
                              className="save-reschedule-button"
                              onClick={() =>
                                rescheduleAppointment(appointment.id)
                              }
                            >
                              Save Reschedule
                            </button>

                            <button
                              className="cancel-reschedule-button"
                              onClick={() => {
                                setReschedulingAppointmentId(null);
                                setRescheduleDate("");
                                setRescheduleTime("");
                              }}
                            >
                              Never Mind
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            {appointments.filter(
              (appointment) =>
                !appointmentDate ||
                appointment.appointment_date.substring(0, 10) ===
                  appointmentDate
            ).length === 0 && (
              <p className="no-appointments">No appointments found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Admin;
