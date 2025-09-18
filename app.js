const API_BASE = "http://localhost:3000/api";

let token = null;
let userId = null;
let userEmail = null;
let userName = null;

function setAuthUI() {
    const status = document.getElementById('authStatus');
    const logoutBtn = document.getElementById('logoutBtn');
    const createBtn = document.getElementById('createEventBtn');
    if (token && userId) {
        status.textContent = `Logged in as ${userName || userEmail}`;
        logoutBtn.style.display = '';
        if (createBtn) createBtn.disabled = false;
    } else {
        status.textContent = 'Not logged in';
        logoutBtn.style.display = 'none';
        if (createBtn) createBtn.disabled = true;
    }
}

function logout() {
    token = null; userId = null; userEmail = null; userName = null;
    setAuthUI();
    loadEvents();
    const myRegs = document.getElementById('myRegistrations');
    if (myRegs) myRegs.innerHTML = '<p>Login to see your registrations.</p>';
    const myEvents = document.getElementById('myEvents');
    if (myEvents) myEvents.innerHTML = '<p>Login to see your events.</p>';
}

async function registerUser() {
    const email = document.getElementById("email").value;
    const name = document.getElementById("name") ? document.getElementById("name").value : "";
    const password = document.getElementById("password").value;
    const created_at = new Date().toISOString();
    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name, created_at, password })
        });
        const data = await res.json();
        alert("Registration: " + JSON.stringify(data));
    } catch (err) {
        alert("Registration failed: " + err);
    }
}

async function loginUser() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.token && data.userId) {
            token = data.token;
            userId = data.userId;
            userEmail = data.email || email;
            userName = data.name || '';
            setAuthUI();
            alert("Logged in as: " + (userName || email));
            loadEvents();
            loadMyRegistrations();
            loadMyEvents();
        } else {
            alert("Login failed: " + (data.message || JSON.stringify(data)));
        }
    } catch (err) {
        alert("Login error: " + err);
    }
}

async function createNewEvent() {
    const title = document.getElementById("title").value;
    const description = document.getElementById("description").value;
    const dtRaw = document.getElementById("date_time").value;
    const location = document.getElementById("location").value;
    const max_capacity_raw = document.getElementById("max_capacity").value;
    console.log('Raw form values:', { title, description, dtRaw, location, max_capacity_raw });
    if (!token) { alert('Please login first'); return; }
    if (!title || !dtRaw || !location || max_capacity_raw === '') {
        alert('Please fill all required fields');
        return;
    }
    let date_time = '';
    try { 
        const dt = new Date(dtRaw);
        if (isNaN(dt.getTime())) {
            alert('Invalid date/time format');
            return;
        }
        date_time = dt.toISOString();
    } catch (e) { 
        alert('Date conversion failed: ' + e.message);
        return;
    }
    const max_capacity = parseInt(max_capacity_raw, 10);
    if (!Number.isInteger(max_capacity) || max_capacity < 0) { alert('Capacity must be a non-negative integer'); return; }
    try {
        const payload = { title, description, date_time, location, max_capacity };
        console.log('Creating event with payload:', payload);
        const res = await fetch(`${API_BASE}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            alert(`Create failed: ${data.message || JSON.stringify(data)}`);
        } else {
            alert("Event created successfully!");
            // Clear the form
            document.getElementById("title").value = '';
            document.getElementById("description").value = '';
            document.getElementById("date_time").value = '';
            document.getElementById("location").value = '';
            document.getElementById("max_capacity").value = '';
            // Refresh the event lists
            loadEvents();
            loadMyEvents();
        }
    } catch (err) {
        alert("Event creation failed: " + err);
    }
}

async function loadEvents() {
    try {
        const res = await fetch(`${API_BASE}/events`, { method: "GET" });
        const events = await res.json();
        const eventsDiv = document.getElementById("events");
        eventsDiv.innerHTML = "";
        if (Array.isArray(events)) {
            events.forEach(event => {
                const eventDiv = document.createElement("div");
                eventDiv.className = "event";
                eventDiv.innerHTML = `
                    <h3>${event.title}</h3>
                    <p>${event.description}</p>
                    <p><strong>Date:</strong> ${new Date(event.date_time).toLocaleString()}</p>
                    <p><strong>Location:</strong> ${event.location}</p>
                    <p><strong>Capacity:</strong> ${event.max_capacity} | <strong>Available:</strong> ${event.available_spots ?? '—'}</p>
                    <div class="actions">
                        ${(() => { const full = (event.available_spots !== undefined && event.available_spots <= 0); const dis = !token || full; const label = full ? 'Full' : 'Register'; return `<button onclick="registerForEvent('${event.id}')" ${dis ? 'disabled' : ''}>${label}</button>`; })()}
                        ${token && event.created_by === userId ? `<button onclick="promptEditEvent('${event.id}')">Edit</button>
                        <button class="danger" onclick="deleteEvent('${event.id}')">Delete</button>` : ''}
                    </div>
                `;
                eventsDiv.appendChild(eventDiv);
            });
        } else {
            eventsDiv.innerHTML = "<p>No events found.</p>";
        }
    } catch (err) {
        alert("Failed to load events: " + err);
    }
}

async function registerForEvent(eventId) {
    try {
        const res = await fetch(`${API_BASE}/events/${eventId}/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });
        const data = await res.json();
        if (res.ok) {
            alert("Registered successfully");
            loadEvents();
            loadMyRegistrations();
        } else {
            alert("Register failed: " + (data.message || JSON.stringify(data)));
        }
    } catch (err) {
        alert("Registration failed: " + err);
    }
}

async function loadMyRegistrations() {
    if (!userId || !token) return;
    try {
        const res = await fetch(`${API_BASE}/users/${userId}/registrations`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const regs = await res.json();
        const div = document.getElementById("myRegistrations");
        if (!div) return;
        div.innerHTML = "";
        if (Array.isArray(regs) && regs.length) {
            regs.forEach(r => {
                const row = document.createElement("div");
                row.className = "registration";
                row.innerHTML = `
                    <span>${r.title} — ${new Date(r.date_time).toLocaleString()} (${r.status})</span>
                    ${r.status === 'registered' ? `<button onclick="cancelRegistration('${r.event_id}')">Cancel</button>` : ''}
                `;
                div.appendChild(row);
            });
        } else {
            div.innerHTML = "<p>No registrations yet.</p>";
        }
    } catch (err) {
        console.error(err);
    }
}

async function cancelRegistration(eventId) {
    try {
        const res = await fetch(`${API_BASE}/events/${eventId}/register`, {
            method: 'DELETE',
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            alert("Registration cancelled");
            loadEvents();
            loadMyRegistrations();
        } else {
            alert("Cancel failed: " + (data.message || JSON.stringify(data)));
        }
    } catch (err) {
        alert("Cancel error: " + err);
    }
}

async function loadMyEvents() {
    if (!token || !userId) return;
    try {
        const res = await fetch(`${API_BASE}/users/${userId}/events`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
        const mine = await res.json();
        const div = document.getElementById('myEvents');
        if (!div) return;
        div.innerHTML = '';
        if (!mine.length) { div.innerHTML = '<p>No events created yet.</p>'; return; }
        mine.forEach(e => {
            const el = document.createElement('div');
            el.className = 'event';
            el.innerHTML = `
                <h3>${e.title}</h3>
                <p class="meta">${new Date(e.date_time).toLocaleString()} • ${e.location}</p>
                <p>${e.description || ''}</p>
                <p><strong>Capacity:</strong> ${e.max_capacity} • <strong>Registered:</strong> ${e.registrations ?? '-'} </p>
                <div class="actions">
                    <button onclick="promptEditEvent('${e.id}')">Edit</button>
                    <button class="danger" onclick="deleteEvent('${e.id}')">Delete</button>
                </div>
            `;
            div.appendChild(el);
        });
    } catch (e) {
        console.error(e);
    }
}

function promptEditEvent(eventId) {
    const title = prompt('New title (leave blank to keep)');
    const description = prompt('New description (leave blank to keep)');
    const date_time = prompt('New ISO date-time (leave blank to keep)');
    const location = prompt('New location (leave blank to keep)');
    const max_capacity = prompt('New capacity (leave blank to keep)');
    const payload = {};
    if (title) payload.title = title;
    if (description) payload.description = description;
    if (date_time) payload.date_time = date_time;
    if (location) payload.location = location;
    if (max_capacity) payload.max_capacity = Number(max_capacity);
    updateEvent(eventId, payload);
}

async function updateEvent(eventId, payload) {
    if (!token) { alert('Please login first'); return; }
    try {
        const res = await fetch(`${API_BASE}/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) { alert('Update failed: ' + (data.message || JSON.stringify(data))); return; }
        alert('Event updated');
        loadEvents();
        loadMyEvents();
    } catch (e) {
        alert('Update error: ' + e);
    }
}

async function deleteEvent(eventId) {
    if (!token) { alert('Please login first'); return; }
    if (!confirm('Delete this event?')) return;
    try {
        const res = await fetch(`${API_BASE}/events/${eventId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) { alert('Delete failed: ' + (data.message || JSON.stringify(data))); return; }
        alert('Event deleted');
        loadEvents();
        loadMyEvents();
    } catch (e) {
        alert('Delete error: ' + e);
    }
}

// Make functions globally accessible
window.createNewEvent = createNewEvent;
window.loginUser = loginUser;
window.registerUser = registerUser;
window.logout = logout;
window.registerForEvent = registerForEvent;
window.cancelRegistration = cancelRegistration;
window.promptEditEvent = promptEditEvent;
window.deleteEvent = deleteEvent;

// Auto-load events on page load
window.addEventListener('DOMContentLoaded', () => {
    console.log('App loaded. Functions available:', {
        createNewEvent: typeof window.createNewEvent,
        loginUser: typeof window.loginUser,
        registerUser: typeof window.registerUser
    });
    loadEvents();
    setAuthUI();
});
