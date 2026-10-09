/* ============================================================
   SkyBridge Travels — admin.js
   Admin dashboard: auth guard, tab switching, CRUD for jobs,
   tours, destinations, applications, bookings, messages, settings.
   ============================================================ */

// ---- Auth guard ----
// A static site can't validate a session on a server, so this is a client-side
// safeguard only: it checks a session flag AND expires it after 30 minutes of
// inactivity. A production deployment needs real server-side session checks.
const SESSION_TTL_MS = 30 * 60 * 1000;
const session = sessionStorage.getItem('ww_admin');
if (!session) {
    window.location.href = 'login.html';
} else {
    const parsed = JSON.parse(session);
    if (Date.now() - parsed.ts > SESSION_TTL_MS) {
        sessionStorage.removeItem('ww_admin');
        window.location.href = 'login.html?expired=1';
    }
}
// Refresh the session timestamp on activity so active admins aren't logged out
['click', 'keydown'].forEach(evt => document.addEventListener(evt, () => {
    const s = sessionStorage.getItem('ww_admin');
    if (s) { const p = JSON.parse(s); p.ts = Date.now(); sessionStorage.setItem('ww_admin', JSON.stringify(p)); }
}));

document.getElementById('logoutBtn').addEventListener('click', e => {
    e.preventDefault();
    sessionStorage.removeItem('ww_admin');
    WWAuth.signOut();
    window.location.href = 'login.html';
});

// Real server-side guard: the sessionStorage flag above is just a fast,
// same-tab UI check. The actual access boundary is enforced by Firebase —
// if there is no genuine signed-in Firebase user, every read/write this
// dashboard makes to the database is rejected by the security rules
// (see database.rules.json), regardless of local flags. This listener
// catches the case of a stale/faked local flag with no real Firebase
// session behind it, and sends the browser back to login.
if (wwFirebaseAuth) {
    wwFirebaseAuth.onAuthStateChanged(user => {
        if (!user) {
            sessionStorage.removeItem('ww_admin');
            window.location.href = 'login.html';
        }
    });
}

// ---- Live clock (proof of real-time client) ----
function tickClock() {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleString();
}
setInterval(tickClock, 1000);
tickClock();

// ---- Tab switching ----
const TABS = ['overview', 'jobs', 'applications', 'tours', 'destinations', 'bookings', 'messages', 'settings'];
document.querySelectorAll('.admin-sidebar a[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.admin-sidebar a').forEach(a => a.classList.remove('active'));
        link.classList.add('active');
        const tab = link.dataset.tab;
        TABS.forEach(t => {
            document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
        });
        document.getElementById('pageTitle').textContent = link.textContent.trim();
    });
});

// ---- Helpers ----
function esc(s) { return wwEsc(s); }
function statusBadgeClass(status) { return 'badge-' + String(status || '').toLowerCase(); }

// ---- Simple bar chart renderer (no external library) ----
function renderBarChart(elId, dataObj, altEveryOther) {
    const el = document.getElementById(elId);
    if (!el) return;
    const entries = Object.entries(dataObj);
    const max = Math.max(1, ...entries.map(e => e[1]));
    el.innerHTML = entries.map(([label, val], i) => `
        <div class="bar-col">
            <div class="bar-val">${val}</div>
            <div class="bar ${altEveryOther && i % 2 ? 'alt' : ''}" style="height:${Math.max(4, (val / max) * 100)}%;"></div>
            <div class="bar-label">${esc(label)}</div>
        </div>
    `).join('') || '<p class="field-hint">No data yet.</p>';
}

function groupCount(arr, keyFn) {
    const out = {};
    arr.forEach(item => {
        const k = keyFn(item) || 'Unknown';
        out[k] = (out[k] || 0) + 1;
    });
    return out;
}

// ============================================================
// OVERVIEW
// ============================================================
function refreshOverview() {
    const jobs = WW.getJobs();
    const apps = WW.getApplications();
    const tours = WW.getTours();
    const dests = WW.getDestinations();
    const bookings = WW.getBookings();

    document.getElementById('statJobs').textContent = jobs.length;
    document.getElementById('statApps').textContent = apps.length;
    document.getElementById('statTours').textContent = tours.length;
    document.getElementById('statDests').textContent = dests.length;
    document.getElementById('statBookings').textContent = bookings.length;
    document.getElementById('statPending').textContent =
        apps.filter(a => a.status === 'Pending').length + bookings.filter(b => b.status === 'Pending').length;

    renderBarChart('chartApps', groupCount(apps, a => a.status));
    renderBarChart('chartBookings', groupCount(bookings, b => b.status));
    renderBarChart('chartJobsCat', groupCount(jobs, j => j.category), true);
    renderBarChart('chartToursCat', groupCount(tours, t => t.category), true);

    const recent = apps.slice(-5).reverse();
    document.getElementById('recentAppsTable').innerHTML = recent.length ? recent.map(a => `
        <tr><td>${esc(a.id)}</td><td>${esc(a.applicant)}</td><td>${esc(a.jobTitle)}</td>
        <td><span class="badge-status ${statusBadgeClass(a.status)}">${esc(a.status)}</span></td>
        <td>${new Date(a.appliedAt).toLocaleDateString()}</td></tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);">No applications yet</td></tr>';
}

// ============================================================
// JOBS
// ============================================================
function refreshJobs() {
    const jobs = WW.getJobs();
    document.getElementById('jobsTable').innerHTML = jobs.map(j => `
        <tr>
            <td>${esc(j.title)}</td><td>${esc(j.company)}</td><td>${esc(j.country)}</td>
            <td>${esc(j.category)}</td><td>${esc(j.type)}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="editJob(${j.id})">Edit</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="deleteJob(${j.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}

function openJobModal(job) {
    document.getElementById('jobModal').classList.add('open');
    if (job) {
        document.getElementById('jobModalTitle').textContent = 'Edit Job';
        document.getElementById('jobId').value = job.id;
        document.getElementById('jobTitle').value = job.title;
        document.getElementById('jobCompany').value = job.company;
        document.getElementById('jobCountry').value = job.country;
        document.getElementById('jobCity').value = job.city;
        document.getElementById('jobCategory').value = job.category;
        document.getElementById('jobIndustry').value = job.industry;
        document.getElementById('jobType').value = job.type;
        document.getElementById('jobSalary').value = job.salary || '';
        document.getElementById('jobDeadline').value = job.deadline || '';
        document.getElementById('jobDescription').value = job.description || '';
        document.getElementById('jobRequirements').value = (job.requirements || []).join('\n');
        document.getElementById('jobBenefits').value = (job.benefits || []).join('\n');
    } else {
        document.getElementById('jobModalTitle').textContent = 'Add Job';
        document.getElementById('jobForm').reset();
        document.getElementById('jobId').value = '';
    }
}
function closeJobModal() { document.getElementById('jobModal').classList.remove('open'); }
function editJob(id) { const job = WW.getJobs().find(j => j.id === id); if (job) openJobModal(job); }
function deleteJob(id) {
    if (!confirm('Delete this job?')) return;
    WW.saveJobs(WW.getJobs().filter(j => j.id !== id));
    refreshAll();
}
document.getElementById('jobForm').addEventListener('submit', e => {
    e.preventDefault();
    const jobs = WW.getJobs();
    const id = document.getElementById('jobId').value;
    const data = {
        title: document.getElementById('jobTitle').value,
        company: document.getElementById('jobCompany').value,
        country: document.getElementById('jobCountry').value,
        city: document.getElementById('jobCity').value,
        category: document.getElementById('jobCategory').value,
        industry: document.getElementById('jobIndustry').value,
        type: document.getElementById('jobType').value,
        salary: document.getElementById('jobSalary').value,
        deadline: document.getElementById('jobDeadline').value,
        description: document.getElementById('jobDescription').value,
        requirements: document.getElementById('jobRequirements').value.split('\n').map(s => s.trim()).filter(Boolean),
        benefits: document.getElementById('jobBenefits').value.split('\n').map(s => s.trim()).filter(Boolean),
        posted: 'Just now'
    };
    if (id) {
        const idx = jobs.findIndex(j => j.id === parseInt(id));
        jobs[idx] = { ...jobs[idx], ...data };
    } else {
        data.id = Date.now();
        jobs.push(data);
    }
    WW.saveJobs(jobs);
    closeJobModal();
    refreshAll();
});

// ============================================================
// APPLICATIONS
// ============================================================
function refreshApplications() {
    const apps = WW.getApplications();
    document.getElementById('appsTable').innerHTML = apps.length ? apps.slice().reverse().map(a => `
        <tr>
            <td>${esc(a.id)}</td><td>${esc(a.applicant)}</td><td>${esc(a.email)}</td><td>${esc(a.jobTitle)}</td>
            <td><span class="badge-status ${statusBadgeClass(a.status)}">${esc(a.status)}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="viewApplication('${esc(a.id)}')"><i class="fas fa-eye"></i> View</button>
                <button class="btn btn-sm" style="background:#28a745;color:white;" onclick="setAppStatus('${a.id}','Approved')">Approve</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="setAppStatus('${a.id}','Rejected')">Reject</button>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);">No applications yet</td></tr>';
}
function setAppStatus(id, status) {
    WW.setApplicationStatus(id, status);
    refreshAll();
}

// ============================================================
// FULL DETAILS (applications + bookings)
// Opens a window showing everything the visitor submitted, plus quick
// actions. Re-renders itself if the record changes while it's open
// (e.g. the status is updated, or Firebase pushes a change).
// ============================================================
let currentDetail = null; // { type: 'application' | 'booking', id }

function detailRow(label, valueHtml) {
    return `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${valueHtml}</div></div>`;
}
function detailText(v) {
    return (v !== undefined && v !== null && String(v).trim() !== '')
        ? esc(v) : '<span class="detail-empty">Not provided</span>';
}
function detailLong(v) {
    return (v && String(v).trim() !== '')
        ? `<div class="detail-long">${esc(v)}</div>` : '<span class="detail-empty">Not provided</span>';
}
function detailDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '<span class="detail-empty">Unknown</span>' : esc(d.toLocaleString());
}
function detailContactLinks(email, phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    return {
        email: email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : detailText(''),
        phone: phone ? `<a href="tel:+${esc(digits)}">${esc(phone)}</a>` : detailText('')
    };
}

function viewApplication(id) {
    currentDetail = { type: 'application', id };
    renderDetail();
    document.getElementById('detailModal').classList.add('open');
}
function viewBooking(id) {
    currentDetail = { type: 'booking', id };
    renderDetail();
    document.getElementById('detailModal').classList.add('open');
}
function closeDetailModal() {
    currentDetail = null;
    document.getElementById('detailModal').classList.remove('open');
}

function renderDetail() {
    if (!currentDetail) return;
    const body = document.getElementById('detailBody');
    if (currentDetail.type === 'application') {
        const a = WW.getApplications().find(x => x.id === currentDetail.id);
        if (!a) { body.innerHTML = '<p class="field-hint">This application is no longer available.</p>'; return; }
        const c = detailContactLinks(a.email, a.phone);
        const job = WW.getJobs().find(j => String(j.id) === String(a.jobId));
        const waLink = WW.whatsappLink({ phone: a.phone, body: `Hi ${a.applicant}, this is SkyBridge Travels regarding your application ${a.id} for "${a.jobTitle}".` });
        const mailLink = WW.mailtoLink({ to: a.email, subject: `Your application ${a.id} — ${a.jobTitle}`, body: `Hi ${a.applicant},\n\n` });
        body.innerHTML = `
            <div class="detail-head">
                <div>
                    <div class="detail-kicker">Job application</div>
                    <h2>${esc(a.applicant)}</h2>
                    <div class="detail-ref">Ref ${esc(a.id)}</div>
                </div>
                <span class="badge-status ${statusBadgeClass(a.status)}">${esc(a.status)}</span>
            </div>

            <div class="detail-section">
                <h4>Applicant</h4>
                ${detailRow('Full name', detailText(a.applicant))}
                ${detailRow('Email', c.email)}
                ${detailRow('Phone / WhatsApp', c.phone)}
                ${detailRow('Country of residence', detailText(a.country))}
            </div>

            <div class="detail-section">
                <h4>Position applied for</h4>
                ${detailRow('Job', detailText(a.jobTitle))}
                ${detailRow('Employer', detailText(a.company))}
                ${job ? detailRow('Location', detailText(job.city + ', ' + job.country)) : ''}
                ${job ? detailRow('Salary', detailText(job.salary)) : ''}
                ${detailRow('Submitted', detailDate(a.appliedAt))}
            </div>

            <div class="detail-section">
                <h4>Background</h4>
                ${detailRow('CV / Resume file', a.cvFileName
                    ? `${esc(a.cvFileName)} <span class="detail-note">(file name only — see note below)</span>`
                    : detailText(''))}
                ${detailRow('Qualifications', detailText(a.qualifications))}
                ${detailRow('Work experience', detailLong(a.experience))}
                ${detailRow('Cover letter', detailLong(a.coverLetter))}
            </div>
            <p class="detail-note" style="margin-top:4px;">The site records the name of the CV the applicant chose but does not store the file itself — ask the applicant to email or WhatsApp their CV.</p>

            <div class="detail-actions">
                <button class="btn btn-sm" style="background:#28a745;color:white;" onclick="setAppStatus('${esc(a.id)}','Approved')"><i class="fas fa-check"></i> Approve</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="setAppStatus('${esc(a.id)}','Rejected')"><i class="fas fa-times"></i> Reject</button>
                <a class="btn btn-outline btn-sm" href="${mailLink}"><i class="fas fa-envelope"></i> Email</a>
                ${waLink ? `<a class="btn btn-outline btn-sm" href="${waLink}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
            </div>`;
    } else {
        const b = WW.getBookings().find(x => x.id === currentDetail.id);
        if (!b) { body.innerHTML = '<p class="field-hint">This booking is no longer available.</p>'; return; }
        const c = detailContactLinks(b.email, b.phone);
        const tour = WW.getTours().find(t => String(t.id) === String(b.tourId));
        const n = parseInt(b.travellers, 10);
        const total = (tour && Number(tour.price) && n) ? '$' + (Number(tour.price) * n).toLocaleString() : null;
        const waLink = WW.whatsappLink({ phone: b.phone, body: `Hi ${b.name}, this is SkyBridge Travels regarding your booking ${b.id} for "${b.tourName}".` });
        const mailLink = WW.mailtoLink({ to: b.email, subject: `Your booking ${b.id} — ${b.tourName}`, body: `Hi ${b.name},\n\n` });
        body.innerHTML = `
            <div class="detail-head">
                <div>
                    <div class="detail-kicker">Tour booking</div>
                    <h2>${esc(b.name)}</h2>
                    <div class="detail-ref">Ref ${esc(b.id)}</div>
                </div>
                <span class="badge-status ${statusBadgeClass(b.status)}">${esc(b.status)}</span>
            </div>

            <div class="detail-section">
                <h4>Traveller</h4>
                ${detailRow('Full name', detailText(b.name))}
                ${detailRow('Email', c.email)}
                ${detailRow('Phone / WhatsApp', c.phone)}
            </div>

            <div class="detail-section">
                <h4>Trip</h4>
                ${detailRow('Tour', detailText(b.tourName))}
                ${tour ? detailRow('Destination', detailText(tour.dest)) : ''}
                ${tour ? detailRow('Duration', detailText(tour.days + ' days')) : ''}
                ${detailRow('Preferred date', detailText(b.date))}
                ${detailRow('Travellers', detailText(b.travellers))}
                ${tour ? detailRow('Price per person', detailText('$' + Number(tour.price).toLocaleString())) : ''}
                ${total ? detailRow('Estimated total', `<strong>${esc(total)}</strong>`) : ''}
                ${detailRow('Requested on', detailDate(b.bookedAt))}
            </div>

            <div class="detail-section">
                <h4>Special requests</h4>
                ${detailLong(b.notes)}
            </div>

            <div class="detail-actions">
                <button class="btn btn-sm" style="background:#28a745;color:white;" onclick="setBookingStatus('${esc(b.id)}','Confirmed')"><i class="fas fa-check"></i> Confirm</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="setBookingStatus('${esc(b.id)}','Cancelled')"><i class="fas fa-times"></i> Cancel</button>
                <a class="btn btn-outline btn-sm" href="${mailLink}"><i class="fas fa-envelope"></i> Email</a>
                ${waLink ? `<a class="btn btn-outline btn-sm" href="${waLink}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
            </div>`;
    }
}

// Close with a click on the dark backdrop or the Escape key.
document.getElementById('detailModal').addEventListener('click', e => {
    if (e.target.id === 'detailModal') closeDetailModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && currentDetail) closeDetailModal(); });

// ============================================================
// TOURS
// ============================================================
function refreshTours() {
    const tours = WW.getTours();
    document.getElementById('toursTable').innerHTML = tours.map(t => `
        <tr>
            <td><div class="table-thumb-cell"><div class="thumb" style="background-image:url('${esc(t.img)}')"></div>${esc(t.name)}</div></td>
            <td>${esc(t.dest)}</td><td>${t.days}</td><td>$${Number(t.price).toLocaleString()}</td>
            <td>${esc(t.category)}</td><td>${esc(t.availability)}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="editTour(${t.id})">Edit</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="deleteTour(${t.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}
function openTourModal(tour) {
    document.getElementById('tourModal').classList.add('open');
    if (tour) {
        document.getElementById('tourModalTitle').textContent = 'Edit Tour';
        document.getElementById('tourId').value = tour.id;
        document.getElementById('tourName').value = tour.name;
        document.getElementById('tourDest').value = tour.dest;
        document.getElementById('tourDays').value = tour.days;
        document.getElementById('tourPrice').value = tour.price;
        document.getElementById('tourCategory').value = tour.category;
        document.getElementById('tourAvailability').value = tour.availability;
        document.getElementById('tourImg').value = tour.img || '';
        document.getElementById('tourDesc').value = tour.desc || '';
        document.getElementById('tourActivities').value = (tour.activities || []).join(', ');
    } else {
        document.getElementById('tourModalTitle').textContent = 'Add Tour';
        document.getElementById('tourForm').reset();
        document.getElementById('tourId').value = '';
    }
}
function closeTourModal() { document.getElementById('tourModal').classList.remove('open'); }
function editTour(id) { const t = WW.getTours().find(x => x.id === id); if (t) openTourModal(t); }
function deleteTour(id) {
    if (!confirm('Delete this tour? It will disappear from the public Tours page immediately.')) return;
    WW.saveTours(WW.getTours().filter(t => t.id !== id));
    refreshAll();
}
document.getElementById('tourForm').addEventListener('submit', e => {
    e.preventDefault();
    const tours = WW.getTours();
    const id = document.getElementById('tourId').value;
    const data = {
        name: document.getElementById('tourName').value,
        dest: document.getElementById('tourDest').value,
        days: parseInt(document.getElementById('tourDays').value, 10),
        price: parseFloat(document.getElementById('tourPrice').value),
        category: document.getElementById('tourCategory').value,
        availability: document.getElementById('tourAvailability').value,
        img: document.getElementById('tourImg').value || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&auto=format&fit=crop',
        desc: document.getElementById('tourDesc').value,
        activities: document.getElementById('tourActivities').value.split(',').map(s => s.trim()).filter(Boolean)
    };
    if (id) {
        const idx = tours.findIndex(t => t.id === parseInt(id));
        tours[idx] = { ...tours[idx], ...data };
    } else {
        data.id = Date.now();
        tours.push(data);
    }
    WW.saveTours(tours);
    closeTourModal();
    refreshAll();
});

// ============================================================
// DESTINATIONS
// ============================================================
function refreshDestinations() {
    const dests = WW.getDestinations();
    document.getElementById('destsTable').innerHTML = dests.map(d => `
        <tr>
            <td><div class="table-thumb-cell"><div class="thumb" style="background-image:url('${esc(d.img)}')"></div>${esc(d.name)}</div></td>
            <td>${esc(d.country)}</td><td>${esc(d.region)}</td><td>${WW.packageCountFor(d.name)}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="editDest(${d.id})">Edit</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="deleteDest(${d.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}
function openDestModal(dest) {
    document.getElementById('destModal').classList.add('open');
    if (dest) {
        document.getElementById('destModalTitle').textContent = 'Edit Destination';
        document.getElementById('destId').value = dest.id;
        document.getElementById('destName').value = dest.name;
        document.getElementById('destCountry').value = dest.country;
        document.getElementById('destRegionSel').value = dest.region;
        document.getElementById('destImg').value = dest.img || '';
        document.getElementById('destDesc').value = dest.desc || '';
        document.getElementById('destAttractions').value = (dest.attractions || []).join(', ');
    } else {
        document.getElementById('destModalTitle').textContent = 'Add Destination';
        document.getElementById('destForm').reset();
        document.getElementById('destId').value = '';
    }
}
function closeDestModal() { document.getElementById('destModal').classList.remove('open'); }
function editDest(id) { const d = WW.getDestinations().find(x => x.id === id); if (d) openDestModal(d); }
function deleteDest(id) {
    if (!confirm('Delete this destination?')) return;
    WW.saveDestinations(WW.getDestinations().filter(d => d.id !== id));
    refreshAll();
}
document.getElementById('destForm').addEventListener('submit', e => {
    e.preventDefault();
    const dests = WW.getDestinations();
    const id = document.getElementById('destId').value;
    const data = {
        name: document.getElementById('destName').value,
        country: document.getElementById('destCountry').value,
        region: document.getElementById('destRegionSel').value,
        img: document.getElementById('destImg').value || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&auto=format&fit=crop',
        desc: document.getElementById('destDesc').value,
        attractions: document.getElementById('destAttractions').value.split(',').map(s => s.trim()).filter(Boolean)
    };
    if (id) {
        const idx = dests.findIndex(d => d.id === parseInt(id));
        dests[idx] = { ...dests[idx], ...data };
    } else {
        data.id = Date.now();
        dests.push(data);
    }
    WW.saveDestinations(dests);
    closeDestModal();
    refreshAll();
});

// ============================================================
// BOOKINGS
// ============================================================
function refreshBookings() {
    const bookings = WW.getBookings();
    document.getElementById('bookingsTable').innerHTML = bookings.length ? bookings.slice().reverse().map(b => `
        <tr>
            <td>${esc(b.id)}</td><td>${esc(b.name)}</td><td>${esc(b.tourName)}</td>
            <td>${esc(b.date)}</td><td>${esc(b.travellers)}</td>
            <td><span class="badge-status ${statusBadgeClass(b.status)}">${esc(b.status)}</span></td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="viewBooking('${esc(b.id)}')"><i class="fas fa-eye"></i> View</button>
                <button class="btn btn-sm" style="background:#28a745;color:white;" onclick="setBookingStatus('${b.id}','Confirmed')">Confirm</button>
                <button class="btn btn-sm" style="background:#dc3545;color:white;" onclick="setBookingStatus('${b.id}','Cancelled')">Cancel</button>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);">No bookings yet</td></tr>';
}
function setBookingStatus(id, status) {
    WW.setBookingStatus(id, status);
    refreshAll();
}

// ============================================================
// MESSAGES (notification log, synced live via Firebase)
// ============================================================
function refreshMessages() {
    const messages = WW.getMessages().slice().reverse();
    const el = document.getElementById('messagesList');
    if (!messages.length) {
        el.innerHTML = '<p class="field-hint">No automated messages yet. They appear here whenever a booking or application is submitted or its status changes.</p>';
        return;
    }
    el.innerHTML = messages.map(m => {
        const mailto = WW.mailtoLink(m);
        const wa = WW.whatsappLink(m);
        return `
        <div class="msg-item">
            <div class="msg-head">
                <span>${esc(m.type.replace(/_/g, ' '))} · ${new Date(m.createdAt).toLocaleString()}</span>
                <span>${m.sent ? '<span class="msg-sent-tag"><i class="fas fa-check-circle"></i> Sent</span>' : ''}</span>
            </div>
            <div class="msg-subject">${esc(m.subject)}</div>
            <div class="msg-body">${esc(m.body)}</div>
            <div class="msg-actions">
                <a class="btn btn-outline btn-sm" href="${mailto}" onclick="WW.markMessageSent('${m.id}')"><i class="fas fa-envelope"></i> Open email</a>
                ${wa ? `<a class="btn btn-outline btn-sm" href="${wa}" target="_blank" rel="noopener" onclick="WW.markMessageSent('${m.id}')"><i class="fab fa-whatsapp"></i> Open WhatsApp</a>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettingsForm() {
    const s = WW.getSettings();
    document.getElementById('setWhatsapp').value = s.whatsappNumber;
    document.getElementById('setEmail').value = s.notifyEmail;

}
document.getElementById('settingsForm').addEventListener('submit', e => {
    e.preventDefault();
    WW.saveSettings({
        whatsappNumber: document.getElementById('setWhatsapp').value.replace(/[^\d]/g, ''),
        notifyEmail: document.getElementById('setEmail').value,

        siteName: 'SkyBridge Travels'
    });
    alert('Settings saved. Changes apply immediately across the site.');
});
document.getElementById('passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    if (p1 !== p2) { alert("Passwords don't match."); return; }
    try {
        await WWAuth.setPassword(p1);
        document.getElementById('passwordForm').reset();
        document.getElementById('pwSuccess').style.display = 'block';
        setTimeout(() => document.getElementById('pwSuccess').style.display = 'none', 3000);
    } catch (err) {
        if (err.code === 'auth/requires-recent-login') {
            alert("For security, Firebase needs you to have signed in recently to change your password. Please log out and log back in, then try again right away.");
        } else {
            alert('Could not update password: ' + (err.message || err.code || 'unknown error'));
        }
    }
});

// ============================================================
// Refresh everything + live cross-tab sync
// ============================================================
function refreshAll() {
    refreshOverview();
    refreshJobs();
    refreshApplications();
    refreshTours();
    refreshDestinations();
    refreshBookings();
    refreshMessages();
    renderDetail();
}

loadSettingsForm();
refreshAll();

// Live updates — two layers:
// 1) "storage" fires when another TAB on this same browser changes localStorage.
// 2) "ww:<path>-updated" fires whenever Firebase pushes fresh data to THIS tab's
//    cache (see WWSync in main.js) — e.g. a customer submits an application from
//    their own phone, or the admin is logged in on two devices at once.
// Together, the dashboard reflects changes from anywhere in real time.
window.addEventListener('storage', e => {
    if (['ww_jobs','ww_applications','ww_tours','ww_destinations','ww_bookings','ww_messages'].includes(e.key)) {
        refreshAll();
    }
});
['jobs','applications','tours','destinations','bookings','messages','settings'].forEach(path => {
    document.addEventListener('ww:' + path + '-updated', () => {
        if (path === 'settings') { loadSettingsForm(); return; }
        refreshAll();
    });
});
