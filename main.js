/* ============================================================
   SkyBridge Travels — main.js
   Shared data layer, navigation, and site-wide behaviour.

   IMPORTANT — WHAT "FUNCTIONAL" MEANS IN THIS BUILD
   This site is 100% front-end (HTML/CSS/JS). There is no server.
   All data (jobs, tours, destinations, bookings, applications,
   messages, admin settings) is stored in the browser's
   localStorage, so it persists between visits ON THE SAME BROWSER
   and syncs live across tabs open on the same device (via the
   "storage" event). It does NOT sync across different devices or
   browsers, and it cannot send real emails or WhatsApp messages by
   itself — a static site has no server to hold API keys securely.
   Where the brief asks for automated email/WhatsApp sending, this
   build prepares the exact message and opens it as a ready-to-send
   mailto: link or WhatsApp (wa.me) link, and records it in the
   Admin > Messages log. Wiring that up to send silently in the
   background needs a backend (see README.md).
   ============================================================ */

// ---------- Data version migration ----------
// Bumping DATA_VERSION forces a one-time reseed of the jobs list (e.g. when
// we ship new vacancies). Once Firebase has ever been seeded, Firebase is
// the source of truth and this no longer re-fires — see WWSync below.
const DATA_VERSION = 2;
(function migrateData() {
    const stored = parseInt(localStorage.getItem('ww_data_version') || '0', 10);
    if (stored < DATA_VERSION) {
        localStorage.removeItem('ww_jobs');
        localStorage.setItem('ww_data_version', String(DATA_VERSION));
    }
})();

// ---------- Firebase sync layer ----------
// Firebase Realtime Database (see firebase-config.js) is the real backend
// and single source of truth, shared live across every visitor, browser
// and device. We mirror it into this browser's localStorage as a fast
// local cache, so the rest of the app (jobs.js, admin.js, every page) can
// keep reading data the simple, synchronous way — WW.getJobs() etc. return
// instantly from the cache — while a live listener keeps that cache (and
// the page, via the "ww:<path>-updated" events) in sync with Firebase
// within moments of a change made from ANY device. Writes go to Firebase
// first and update the local cache optimistically at the same time.
// If Firebase can't be reached (offline, blocked, not configured yet),
// everything quietly keeps working from localStorage alone, exactly like
// a single-browser build — see README.md for full setup steps.
const WWSync = {
    // Shared content: readable by everyone, writable only by the signed-in admin.
    PUBLIC_PATHS: ['jobs', 'tours', 'destinations', 'settings'],
    // Visitor submissions: stored as one record per submission, keyed by its
    // reference number (e.g. /applications/WW-2026-K3F9A2X). Visitors can
    // CREATE a record but can never read, change or delete anyone else's —
    // only the signed-in admin can (see database.rules.json). We therefore
    // only start listening to these once the admin is signed in.
    PRIVATE_PATHS: ['applications', 'bookings', 'messages'],
    _privateRefs: {},
    connected: false,

    hasFirebase() { return typeof firebase !== 'undefined' && !!window.wwFirebaseDB; },
    isAdminSignedIn() { return !!(window.wwFirebaseAuth && window.wwFirebaseAuth.currentUser); },

    init(seedFns) {
        if (!this.hasFirebase()) return;
        this.PUBLIC_PATHS.forEach(path => {
            wwFirebaseDB.ref(path).on('value', snap => {
                this.connected = true;
                const val = snap.val();
                if (val === null && seedFns[path]) {
                    // Nothing in Firebase yet for this project — seed it once.
                    // Only the signed-in admin is allowed to write (see rules), so
                    // for an ordinary visitor this is quietly refused and the site
                    // simply keeps using its built-in defaults until the admin
                    // first opens the dashboard, which seeds the database.
                    wwFirebaseDB.ref(path).set(seedFns[path]()).catch(() => {});
                    return;
                }
                if (val !== null) {
                    localStorage.setItem('ww_' + path, JSON.stringify(val));
                    document.dispatchEvent(new CustomEvent('ww:' + path + '-updated', { detail: val }));
                }
            }, err => console.error('Firebase sync error on /' + path + ':', err.message || err));
        });
        // Private collections: attach only while the admin is signed in.
        if (window.wwFirebaseAuth) {
            wwFirebaseAuth.onAuthStateChanged(user => user ? this.attachPrivate() : this.detachPrivate());
        }
    },

    // Firebase returns a keyed object (or an array, for old data that was
    // saved as one). Turn either into a plain array, remembering each
    // record's real database key in `_key` when it differs from its id.
    toArray(val) {
        if (val === null || val === undefined) return [];
        const entries = Array.isArray(val)
            ? val.map((v, i) => [String(i), v])
            : Object.entries(val);
        return entries
            .filter(([, v]) => v && typeof v === 'object')
            .map(([k, v]) => (v.id === k ? v : { ...v, _key: k }))
            .sort((a, b) => String(a.createdAt || a.appliedAt || a.bookedAt || '')
                .localeCompare(String(b.createdAt || b.appliedAt || b.bookedAt || '')));
    },

    attachPrivate() {
        if (!this.hasFirebase()) return;
        this.PRIVATE_PATHS.forEach(path => {
            if (this._privateRefs[path]) return; // already listening
            const ref = wwFirebaseDB.ref(path);
            const cb = snap => {
                const arr = this.toArray(snap.val());
                localStorage.setItem('ww_' + path, JSON.stringify(arr));
                document.dispatchEvent(new CustomEvent('ww:' + path + '-updated', { detail: arr }));
            };
            ref.on('value', cb, err => console.error('Firebase sync error on /' + path + ':', err.message || err));
            this._privateRefs[path] = { ref, cb };
        });
    },
    detachPrivate() {
        this.PRIVATE_PATHS.forEach(path => {
            const h = this._privateRefs[path];
            if (h && h.ref.off) h.ref.off('value', h.cb);
            delete this._privateRefs[path];
            // Don't leave applicants' personal details lying around in this
            // browser once the admin has signed out.
            localStorage.removeItem('ww_' + path);
        });
    },

    // Writes a whole shared collection (jobs/tours/destinations/settings):
    // updates the local cache immediately (optimistic UI), then Firebase.
    write(path, value) {
        localStorage.setItem('ww_' + path, JSON.stringify(value));
        document.dispatchEvent(new CustomEvent('ww:' + path + '-updated', { detail: value }));
        if (this.hasFirebase()) {
            wwFirebaseDB.ref(path).set(value).catch(err => console.error('Firebase write failed on /' + path + ':', err.message || err));
        }
    },

    // Creates ONE submission record at /<path>/<id>. A visitor's browser
    // writes only their own record — it never touches anyone else's — and
    // doesn't keep a local copy (so personal details don't linger on a
    // shared computer). If Firebase isn't available at all, the record is
    // kept locally so it isn't lost.
    addRecord(path, rec) {
        if (this.isAdminSignedIn() || !this.hasFirebase()) {
            const arr = JSON.parse(localStorage.getItem('ww_' + path) || '[]');
            arr.push(rec);
            localStorage.setItem('ww_' + path, JSON.stringify(arr));
            document.dispatchEvent(new CustomEvent('ww:' + path + '-updated', { detail: arr }));
        }
        if (this.hasFirebase()) {
            wwFirebaseDB.ref(path + '/' + rec.id).set(rec)
                .catch(err => console.error('Firebase write failed on /' + path + ':', err.message || err));
        }
    },

    // Admin: change some fields of one existing record.
    updateRecord(path, id, fields) {
        const arr = JSON.parse(localStorage.getItem('ww_' + path) || '[]');
        const rec = arr.find(r => r.id === id);
        const key = (rec && rec._key) || id;
        if (rec) {
            Object.assign(rec, fields);
            localStorage.setItem('ww_' + path, JSON.stringify(arr));
            document.dispatchEvent(new CustomEvent('ww:' + path + '-updated', { detail: arr }));
        }
        if (this.hasFirebase()) {
            wwFirebaseDB.ref(path + '/' + key).update(fields)
                .catch(err => console.error('Firebase update failed on /' + path + ':', err.message || err));
        }
    },

    // Short, effectively collision-free reference number for a new record,
    // e.g. "WW-2026-K3F9A2X" (time-based part + random part).
    newRef(prefix) {
        const t = Date.now().toString(36).slice(-5).toUpperCase();
        const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
        return prefix + '-' + new Date().getFullYear() + '-' + t + r;
    }
};

// ---------- Shared helpers ----------
// Escapes text before it is injected into innerHTML, so that data coming
// from admin-entered fields (job titles, descriptions, tour names, etc.)
// can never be interpreted as HTML/script by a visitor's browser.
function wwEsc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// ---------- Mobile nav toggle ----------
document.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.getElementById('menuBtn');
    const navLinks = document.getElementById('navLinks');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('open');
        });
    }
});

// ---------- Core data store ----------
const WW = {

    // ---- Settings ----
    getSettings() {
        const defaults = {
    // ---- Settings ----
            whatsappNumber: '+233248313606', // digits only, country code first, no + or spaces
            notifyEmail: 'info@skybridgesolutionsgh.com',
            siteName: 'SkyBridge Travels'
        };
        const stored = localStorage.getItem('ww_settings');
        return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    },
    saveSettings(settings) {
        WWSync.write('settings', { ...this.getSettings(), ...settings });
    },

    // ---- Jobs ----
    getJobs() {
        const stored = localStorage.getItem('ww_jobs');
        return stored ? JSON.parse(stored) : this.seedJobs();
    },
    saveJobs(jobs) {
        WWSync.write('jobs', jobs);
    },
    seedJobs() {
        const jobs = [
            {
                id: 1, title: 'Construction Helper', company: 'SkyBridge Partner Employer', country: 'UAE', city: 'Dubai',
                category: 'Construction', industry: 'Construction', type: 'Full-time', salary: 'AED 1,100 - 1,300 / month',
                deadline: 'Ongoing — limited slots', posted: '2 days ago',
                description: 'General construction site work for male candidates in the UAE. Part of an ongoing recruitment drive with online interviews and a guided visa process.',
                requirements: ['Male candidates', 'Valid passport', 'Good health', 'Willingness to work on a construction site', 'Video consent required for shortlisting'],
                benefits: ['Online interview — we guide you through the process', 'Fast-tracked application support']
            },
            {
                id: 2, title: 'Internal & External Cleaner', company: 'SkyBridge Partner Employer', country: 'UAE', city: 'Dubai',
                category: 'Cleaning & Hospitality', industry: 'Facilities Management', type: 'Full-time', salary: 'AED 1,000 - 1,067 / month',
                deadline: '2026-09-15 (online interview date — contact us to confirm current availability)', posted: '3 days ago',
                description: 'Urgent hiring — 200 vacancies for Internal Cleaners (Dhs. 1,067/month) and External Cleaners (Dhs. 1,000/month) in Dubai. Duty hours: 11 hours.',
                requirements: ['English-speaking required for internal cleaners', 'No visible tattoos', 'Age 21–37 years', 'Ready to work as an internal or external cleaner'],
                benefits: ['Accommodation provided', 'Transportation provided', 'Medical insurance provided', 'Employment visa processed in 2 days']
            },
            {
                id: 3, title: 'Warehouse Worker', company: 'SkyBridge Partner Employer', country: 'Serbia', city: 'Serbia',
                category: 'Logistics', industry: 'Warehousing', type: 'Full-time', salary: 'Competitive — details on enquiry',
                deadline: 'Limited slots', posted: '4 days ago',
                description: 'Warehouse workers needed in Serbia. Limited slots available — early application is recommended.',
                requirements: ['Willingness to work in a warehouse environment', 'Valid passport', 'Good health'],
                benefits: ['Guided application process']
            },
            {
                id: 4, title: 'Automotive & Heavy Machinery Technicians (Multiple Roles)', company: 'SkyBridge Partner Employer', country: 'Turkey', city: 'Turkey',
                category: 'Skilled Trades', industry: 'Automotive & Heavy Machinery', type: 'Full-time', salary: 'Competitive — details on enquiry',
                deadline: 'Ongoing', posted: '5 days ago',
                description: 'Work opportunities in Turkey across automotive and heavy machinery: Mechanics (trucks and heavy machinery repair and maintenance), Welders (electrode and gas-shield welding), Bodyworks Specialists, Maintenance Technicians, Tire & Suspension Specialists, Auto Electricians, and Welding/Automotive Repair Assistants.',
                requirements: ['Relevant trade experience or training', 'Valid passport', 'Willingness to relocate to Turkey'],
                benefits: ['Multiple role options under one application']
            },
            {
                id: 5, title: 'Construction Skilled Workers & Helpers (100 Vacancies)', company: 'SkyBridge Partner Employer', country: 'UAE', city: 'UAE',
                category: 'Construction', industry: 'Building Construction', type: 'Full-time', salary: 'Helper AED 1,300 / month • Trade Person AED 1,600 / month',
                deadline: 'Ongoing — limited slots', posted: '6 days ago',
                description: 'Urgent hiring — 100 vacancies open to African nationality candidates for building construction, covering both skilled tradespeople and general helpers.',
                requirements: ['African nationality', 'Valid passport', 'Good health', 'Willingness to work on a construction site'],
                benefits: ['Accommodation provided', 'Transportation provided', 'Medical insurance provided', 'Kitchen facility provided', 'Other benefits as per UAE law']
            },
            {
                id: 6, title: 'Truck Drivers, Warehouse Workers & Welders', company: 'SkyBridge Partner Employer', country: 'Poland', city: 'Poland',
                category: 'Logistics & Trades', industry: 'Logistics', type: 'Contract (3 years)', salary: 'Competitive — details on enquiry',
                deadline: 'Ongoing', posted: '1 week ago',
                description: 'Job opportunities in Poland for Truck Drivers, Warehouse Workers and Welders on a 3-year contract.',
                requirements: ['Relevant experience for the chosen role', 'Valid passport', 'Willingness to relocate to Poland for 3 years'],
                benefits: ['3-year contract stability', 'End-to-end guided process']
            },
            {
                id: 7, title: 'Construction Worker', company: 'SkyBridge Partner Employer', country: 'Montenegro', city: 'Montenegro',
                category: 'Construction', industry: 'Construction', type: 'Full-time', salary: 'Competitive — details on enquiry',
                deadline: 'Limited offer', posted: '1 week ago',
                description: 'Construction workers needed in Montenegro. Limited offer — contact us early to secure a slot.',
                requirements: ['Relevant construction experience', 'Valid passport', 'Good health'],
                benefits: ['Guided application process']
            },
            {
                id: 8, title: 'General Helpers, Welders, Plumbers & Bricklayers', company: 'SkyBridge Partner Employer', country: 'UAE', city: 'Dubai',
                category: 'Construction', industry: 'Building Construction', type: 'Full-time', salary: 'Competitive — details on enquiry',
                deadline: 'Ongoing', posted: '1 week ago',
                description: 'Job opportunities in Dubai for General Helpers, Welders, Plumbers and Bricklayers.',
                requirements: ['Relevant trade experience for the chosen role', 'Valid passport', 'Willingness to relocate to Dubai'],
                benefits: ['Guided application process']
            },
        ];
        this.saveJobs(jobs);
        return jobs;
    },

    // ---- Tours (now admin-editable, was hardcoded in tours.html) ----
    getTours() {
        const stored = localStorage.getItem('ww_tours');
        return stored ? JSON.parse(stored) : this.seedTours();
    },
    saveTours(tours) {
        WWSync.write('tours', tours);
    },
    seedTours() {
        const tours = [
            { id: 1, name: 'Roman Holiday', dest: 'Rome, Italy', days: 5, price: 1290, category: 'Cultural',
              img: 'https://images.unsplash.com/photo-1534445867742-43195f401b6c?w=800&auto=format&fit=crop',
              desc: 'Colosseum, Vatican Museums, and a hands-on pasta making class with a local chef.',
              activities: ['Colosseum tour', 'Vatican Museums', 'Pasta making class', 'Trastevere food walk'],
              availability: 'Available' },
            { id: 2, name: 'Japan Alpine Trail', dest: 'Japanese Alps', days: 8, price: 2450, category: 'Adventure',
              img: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&auto=format&fit=crop',
              desc: 'Hike through the Northern Alps, soak in traditional onsens, and stay in a ryokan.',
              activities: ['Mountain hiking', 'Onsen visits', 'Ryokan stay', 'Local craft workshop'],
              availability: 'Limited spots' },
            { id: 3, name: 'Dubai Luxe Escape', dest: 'Dubai, UAE', days: 4, price: 3100, category: 'Luxury',
              img: 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=800&auto=format&fit=crop',
              desc: 'Burj Khalifa access, desert safari with dinner, and 5-star beachfront accommodation.',
              activities: ['Burj Khalifa', 'Desert safari', 'Yacht cruise', 'Spa day'],
              availability: 'Available' },
            { id: 4, name: 'Paris Romance', dest: 'Paris, France', days: 4, price: 1690, category: 'Cultural',
              img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&auto=format&fit=crop',
              desc: 'Eiffel Tower dinner, Louvre skip-the-line, and a Seine river cruise at sunset.',
              activities: ['Eiffel Tower dinner', 'Louvre Museum', 'Seine cruise', 'Montmartre walk'],
              availability: 'Available' },
            { id: 5, name: 'Kyoto Temple Trail', dest: 'Kyoto, Japan', days: 6, price: 1980, category: 'Cultural',
              img: 'https://images.unsplash.com/photo-1522547902298-51566e4fb383?w=800&auto=format&fit=crop',
              desc: 'Explore Fushimi Inari, Kinkaku-ji, and a traditional tea ceremony in a historic machiya.',
              activities: ['Fushimi Inari', 'Tea ceremony', 'Arashiyama', 'Nishiki Market'],
              availability: 'Available' },
            { id: 6, name: 'Cape Town Explorer', dest: 'Cape Town, South Africa', days: 7, price: 1750, category: 'Adventure',
              img: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&auto=format&fit=crop',
              desc: 'Table Mountain, Cape Winelands, and a Big Five safari in a private reserve.',
              activities: ['Table Mountain', 'Wine tasting', 'Safari', 'Cape Point'],
              availability: 'Available' },
            { id: 7, name: 'Bali Beach & Culture', dest: 'Bali, Indonesia', days: 9, price: 1450, category: 'Beach',
              img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&auto=format&fit=crop',
              desc: 'Ubud rice terraces, Uluwatu sunsets, and beachfront relaxation in Seminyak.',
              activities: ['Rice terraces', 'Temple visits', 'Surf lessons', 'Spa retreat'],
              availability: 'Available' },
            { id: 8, name: 'Moroccan Sands', dest: 'Marrakech, Morocco', days: 5, price: 1120, category: 'Budget',
              img: 'https://images.unsplash.com/photo-1597211833712-5e41faa202ea?w=800&auto=format&fit=crop',
              desc: 'Marrakech souks, Atlas Mountains day trip, and a night in the Sahara under the stars.',
              activities: ['Souk tour', 'Atlas Mountains', 'Sahara camp', 'Cooking class'],
              availability: 'Available' },
            { id: 9, name: 'Sydney Harbour & Beyond', dest: 'Sydney, Australia', days: 6, price: 2200, category: 'Adventure',
              img: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=800&auto=format&fit=crop',
              desc: 'Opera House tour, Bondi coastal walk, and a Blue Mountains day trip.',
              activities: ['Opera House', 'Bondi walk', 'Blue Mountains', 'Harbour cruise'],
              availability: 'Available' }
        ];
        this.saveTours(tours);
        return tours;
    },

    // ---- Destinations (now admin-editable, was hardcoded in destinations.html) ----
    getDestinations() {
        const stored = localStorage.getItem('ww_destinations');
        return stored ? JSON.parse(stored) : this.seedDestinations();
    },
    saveDestinations(dests) {
        WWSync.write('destinations', dests);
    },
    seedDestinations() {
        const dests = [
            { id: 1, name: 'Venice', country: 'Italy', region: 'Europe',
              img: 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=800&auto=format&fit=crop',
              desc: 'Romantic canals, centuries-old architecture, and unforgettable cuisine.',
              attractions: ['St. Mark\'s Basilica', 'Grand Canal', 'Doge\'s Palace'] },
            { id: 2, name: 'Paris', country: 'France', region: 'Europe',
              img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&auto=format&fit=crop',
              desc: 'The city of lights — art, fashion, and world-class cuisine.',
              attractions: ['Eiffel Tower', 'Louvre Museum', 'Montmartre'] },
            { id: 3, name: 'Kyoto', country: 'Japan', region: 'Asia',
              img: 'https://images.unsplash.com/photo-1522547902298-51566e4fb383?w=800&auto=format&fit=crop',
              desc: 'Ancient temples, tranquil gardens, and traditional tea houses.',
              attractions: ['Fushimi Inari', 'Kinkaku-ji', 'Arashiyama Bamboo Grove'] },
            { id: 4, name: 'Dubai', country: 'UAE', region: 'Middle East',
              img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&auto=format&fit=crop',
              desc: 'Ultra-modern skyline meets desert adventure and luxury shopping.',
              attractions: ['Burj Khalifa', 'Palm Jumeirah', 'Dubai Mall'] },
            { id: 5, name: 'Cape Town', country: 'South Africa', region: 'Africa',
              img: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&auto=format&fit=crop',
              desc: 'Where mountains meet the ocean — wildlife, wine, and vibrant culture.',
              attractions: ['Table Mountain', 'V&A Waterfront', 'Boulders Beach'] },
            { id: 6, name: 'New York', country: 'USA', region: 'Americas',
              img: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&auto=format&fit=crop',
              desc: 'The city that never sleeps — iconic landmarks and endless energy.',
              attractions: ['Statue of Liberty', 'Central Park', 'Times Square'] },
            { id: 7, name: 'Bali', country: 'Indonesia', region: 'Asia',
              img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&auto=format&fit=crop',
              desc: 'Lush rice terraces, sacred temples, and world-class surf.',
              attractions: ['Ubud Monkey Forest', 'Tanah Lot', 'Uluwatu Temple'] },
            { id: 8, name: 'Sydney', country: 'Australia', region: 'Oceania',
              img: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=800&auto=format&fit=crop',
              desc: 'Harbour city living with beaches, culture, and outdoor adventure.',
              attractions: ['Opera House', 'Bondi Beach', 'Harbour Bridge'] },
            { id: 9, name: 'Marrakech', country: 'Morocco', region: 'Africa',
              img: 'https://images.unsplash.com/photo-1597211833712-5e41faa202ea?w=800&auto=format&fit=crop',
              desc: 'Bustling souks, ornate palaces, and the gateway to the Sahara.',
              attractions: ['Jemaa el-Fnaa', 'Majorelle Garden', 'Bahia Palace'] }
        ];
        this.saveDestinations(dests);
        return dests;
    },
    // Number of tour packages available for a given destination string (e.g. "Rome, Italy")
    packageCountFor(destName) {
        return this.getTours().filter(t => t.dest.toLowerCase().startsWith(destName.toLowerCase())).length;
    },

    // ---- Job applications ----
    getApplications() {
        const stored = localStorage.getItem('ww_applications');
        return stored ? JSON.parse(stored) : [];
    },
    addApplication(app) {
        app.id = WWSync.newRef('WW');
        app.appliedAt = new Date().toISOString();
        app.status = 'Pending';
        WWSync.addRecord('applications', app);
        this.logMessage({
            type: 'application_received',
            to: app.email,
            phone: app.phone,
            subject: 'We received your application — ' + app.jobTitle,
            body: `Hi ${app.applicant},\n\nThanks for applying for "${app.jobTitle}" at ${app.company}. Your application (ref ${app.id}) has been received and is now being processed by our recruitment team.\n\nWe'll be in touch as soon as there's an update.\n\n— SkyBridge Travels Careers`
        });
        return app;
    },
    setApplicationStatus(id, status) {
        const apps = this.getApplications();
        const app = apps.find(a => a.id === id);
        if (!app) return null;
        app.status = status;
        WWSync.updateRecord('applications', id, { status });
        if (status === 'Approved') {
            this.logMessage({
                type: 'application_approved',
                to: app.email, phone: app.phone,
                subject: 'Good news — interview invitation: ' + app.jobTitle,
                body: `Hi ${app.applicant},\n\nCongratulations — your application for "${app.jobTitle}" (ref ${app.id}) has been approved. Our team will reach out shortly to schedule your interview.\n\n— SkyBridge Travels Careers`
            });
        } else if (status === 'Rejected') {
            this.logMessage({
                type: 'application_rejected',
                to: app.email, phone: app.phone,
                subject: 'Update on your application: ' + app.jobTitle,
                body: `Hi ${app.applicant},\n\nThank you for your interest in "${app.jobTitle}". After careful review, we won't be moving forward with your application at this time. We encourage you to apply for other roles on SkyBridge Travels.\n\n— SkyBridge Travels Careers`
            });
        }
        return app;
    },

    // ---- Tour bookings ----
    getBookings() {
        const stored = localStorage.getItem('ww_bookings');
        return stored ? JSON.parse(stored) : [];
    },
    addBooking(booking) {
        booking.id = WWSync.newRef('TRV');
        booking.bookedAt = new Date().toISOString();
        booking.status = 'Pending';
        WWSync.addRecord('bookings', booking);
        this.logMessage({
            type: 'booking_received',
            to: booking.email, phone: booking.phone,
            subject: 'Booking request received — ' + booking.tourName,
            body: `Hi ${booking.name},\n\nWe've received your booking request for "${booking.tourName}" (ref ${booking.id}, ${booking.travellers} traveller(s), preferred date ${booking.date}). It's now being processed — we'll confirm availability shortly.\n\n— SkyBridge Travels Travel`
        });
        // Notify the organisation too
        this.logMessage({
            type: 'booking_admin_alert',
            to: this.getSettings().notifyEmail, phone: '',
            subject: 'New booking request: ' + booking.tourName,
            body: `New booking request ${booking.id} from ${booking.name} (${booking.email}, ${booking.phone}) for "${booking.tourName}". ${booking.travellers} traveller(s), preferred date ${booking.date}.`
        });
        return booking;
    },
    setBookingStatus(id, status) {
        const bookings = this.getBookings();
        const b = bookings.find(x => x.id === id);
        if (!b) return null;
        b.status = status;
        WWSync.updateRecord('bookings', id, { status });
        if (status === 'Confirmed') {
            this.logMessage({
                type: 'booking_confirmed',
                to: b.email, phone: b.phone,
                subject: 'Booking confirmed — ' + b.tourName,
                body: `Hi ${b.name},\n\nYour booking for "${b.tourName}" (ref ${b.id}) is confirmed for ${b.date}, ${b.travellers} traveller(s). Payment and final itinerary details will follow separately.\n\n— SkyBridge Travels Travel`
            });
        } else if (status === 'Cancelled') {
            this.logMessage({
                type: 'booking_cancelled',
                to: b.email, phone: b.phone,
                subject: 'Booking update — ' + b.tourName,
                body: `Hi ${b.name},\n\nUnfortunately we're unable to confirm your booking for "${b.tourName}" (ref ${b.id}) at this time. Please contact us if you'd like to choose another date or package.\n\n— SkyBridge Travels Travel`
            });
        }
        return b;
    },

    // ---- Message log (stored in Firebase — see WWSync above) ----
    // Each entry represents a message the system prepared automatically
    // (a contact form submission, a new application, etc.), synced live to
    // every admin device. Actually sending email/WhatsApp still needs a
    // real mail/WhatsApp API on a backend; until then, the dashboard gives
    // the admin a one-click pre-filled mailto: / WhatsApp link to dispatch
    // it themselves.
    getMessages() {
        const stored = localStorage.getItem('ww_messages');
        return stored ? JSON.parse(stored) : [];
    },
    logMessage(msg) {
        msg.id = 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        msg.createdAt = new Date().toISOString();
        msg.sent = false;
        WWSync.addRecord('messages', msg);
        return msg;
    },
    markMessageSent(id) {
        WWSync.updateRecord('messages', id, { sent: true });
    },
    mailtoLink(msg) {
        return `mailto:${encodeURIComponent(msg.to)}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
    },
    whatsappLink(msg) {
        const digits = (msg.phone || '').replace(/[^\d]/g, '');
        if (!digits) return null;
        return `https://wa.me/${digits}?text=${encodeURIComponent(msg.body)}`;
    },

    // ---- WhatsApp header button (injected on every page) ----
    whatsappUrl(prefilledText) {
        const num = this.getSettings().whatsappNumber.replace(/[^\d]/g, '');
        const text = prefilledText || `Hi SkyBridge Travels, I'd like to know more about your tours and jobs.`;
        return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
    },
    injectWhatsAppButton() {
        const nav = document.querySelector('.nav-inner');
        if (nav && !document.getElementById('navWhatsapp')) {
            const a = document.createElement('a');
            a.id = 'navWhatsapp';
            a.className = 'nav-whatsapp';
            a.href = this.whatsappUrl();
            a.target = '_blank';
            a.rel = 'noopener';
            a.title = 'Chat with us on WhatsApp';
            a.innerHTML = '<i class="fab fa-whatsapp"></i>';
            const menuBtn = document.getElementById('menuBtn');
            nav.insertBefore(a, menuBtn || null);
        }
        // Floating bubble for quick access while scrolling (mobile-friendly)
        if (!document.getElementById('waFloat')) {
            const fab = document.createElement('a');
            fab.id = 'waFloat';
            fab.className = 'wa-float';
            fab.href = this.whatsappUrl();
            fab.target = '_blank';
            fab.rel = 'noopener';
            fab.title = 'Chat on WhatsApp';
            fab.innerHTML = '<i class="fab fa-whatsapp"></i>';
            document.body.appendChild(fab);
        }
    },

    // ---- Hero image slider ----
    // Three rotating photos (tour sites / destinations / jobs) used behind
    // every hero section. Pure CSS + JS, no external library.
    HERO_SLIDES: [
        { img: 'img/hero-tours.jpg', label: 'Tour Packages' },
        { img: 'img/hero-destinations.jpg', label: 'Study & Travel Destinations' },
        { img: 'img/hero-jobs.jpg', label: 'International Jobs' }
    ],
    initHeroSlider(selector) {
        const hero = document.querySelector(selector || '.hero-slider');
        if (!hero) return;
        const layer = document.createElement('div');
        layer.className = 'hero-slides';
        this.HERO_SLIDES.forEach((s, i) => {
            const div = document.createElement('div');
            div.className = 'hero-slide' + (i === 0 ? ' active' : '');
            div.style.backgroundImage = `url('${s.img}')`;
            layer.appendChild(div);
        });
        hero.insertBefore(layer, hero.firstChild);

        const dots = document.createElement('div');
        dots.className = 'hero-dots';
        this.HERO_SLIDES.forEach((s, i) => {
            const d = document.createElement('button');
            d.type = 'button';
            d.setAttribute('aria-label', 'Show slide: ' + s.label);
            if (i === 0) d.classList.add('active');
            d.addEventListener('click', () => show(i));
            dots.appendChild(d);
        });
        hero.appendChild(dots);

        const slideEls = layer.querySelectorAll('.hero-slide');
        const dotEls = dots.querySelectorAll('button');
        let idx = 0, timer;
        function show(i) {
            slideEls[idx].classList.remove('active');
            dotEls[idx].classList.remove('active');
            idx = (i + slideEls.length) % slideEls.length;
            slideEls[idx].classList.add('active');
            dotEls[idx].classList.add('active');
        }
        function next() { show(idx + 1); }
        function start() { timer = setInterval(next, 5000); }
        function stop() { clearInterval(timer); }
        start();
        hero.addEventListener('mouseenter', stop);
        hero.addEventListener('mouseleave', start);
    },

    // ---- Lightweight anti-spam for public forms ----
    // A static site has no server, so this can't be a real CAPTCHA service —
    // but a simple arithmetic challenge plus a hidden honeypot field stops
    // the overwhelming majority of automated form spam without any backend
    // or third-party key.
    newCaptcha(containerEl) {
        const a = Math.floor(Math.random() * 8) + 1;
        const b = Math.floor(Math.random() * 8) + 1;
        containerEl.dataset.answer = String(a + b);
        containerEl.querySelector('.captcha-q').textContent = `What is ${a} + ${b}?`;
        const input = containerEl.querySelector('.captcha-a');
        if (input) input.value = '';
    },
    checkCaptcha(containerEl) {
        const input = containerEl.querySelector('.captcha-a');
        return !!input && input.value.trim() === containerEl.dataset.answer;
    },
    isHoneypotFilled(formEl) {
        const hp = formEl.querySelector('.hp-field');
        return !!hp && hp.value.trim() !== '';
    }
};

document.addEventListener('DOMContentLoaded', () => WW.injectWhatsAppButton());

// Start the live Firebase sync (see WWSync above). Collections with no
// seed function (applications/bookings/messages) simply stay empty in
// Firebase until the first real submission comes in.
WWSync.init({
    jobs: () => WW.seedJobs(),
    tours: () => WW.seedTours(),
    destinations: () => WW.seedDestinations(),
    settings: () => WW.getSettings()
});

// ---------- Basic clickjacking guard ----------
// If this page is ever loaded inside a third-party iframe (a common setup
// for phishing/clickjacking), break out to the top window.
if (window.top !== window.self) {
    try { window.top.location = window.self.location; } catch (e) { /* cross-origin — ignored */ }
}

// ---------- Admin auth ----------
// Real admin authentication via Firebase Authentication (Email/Password).
// The admin user is created once in Firebase Console (see README.md); this
// app never stores or hashes the password itself — Firebase does that
// server-side. The client-side lockout counter below is just a fast first
// line of defense / UX nicety; Firebase's own servers independently
// rate-limit repeated failed sign-ins regardless of anything in this file.
const WWAuth = {
    lastError: null,
    async verify(username, password) {
        this.lastError = null;
        if (!wwFirebaseAuth) {
            this.lastError = 'The login service is unavailable right now (Firebase did not load). Check your internet connection and try again.';
            return false;
        }
        if (username && username.trim().toLowerCase() !== 'admin') {
            this.lastError = 'Invalid credentials. Please try again.';
            return false;
        }
        try {
            await wwFirebaseAuth.signInWithEmailAndPassword(ADMIN_EMAIL, password);
            return true;
        } catch (err) {
            switch (err.code) {
                case 'auth/too-many-requests':
                    this.lastError = 'Too many failed attempts. Firebase has temporarily blocked sign-ins for this account — please wait a few minutes and try again.';
                    break;
                case 'auth/network-request-failed':
                    this.lastError = 'Network error reaching the login service. Check your connection and try again.';
                    break;
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                case 'auth/invalid-login-credentials':
                    this.lastError = 'Invalid credentials. Please try again.';
                    break;
                default:
                    this.lastError = 'Sign-in failed: ' + (err.message || err.code || 'unknown error');
            }
            return false;
        }
    },
    // Changes the password for the currently signed-in admin. Firebase
    // requires a *recent* sign-in for this; if the session is older than a
    // few minutes it throws 'auth/requires-recent-login' — the caller
    // should ask the admin to log out and back in, then retry.
    async setPassword(newPassword) {
        if (!wwFirebaseAuth || !wwFirebaseAuth.currentUser) throw new Error('Not signed in.');
        await wwFirebaseAuth.currentUser.updatePassword(newPassword);
    },
    signOut() {
        if (wwFirebaseAuth) wwFirebaseAuth.signOut();
    },
    isLockedOut() {
        const until = parseInt(localStorage.getItem('ww_lockout_until') || '0', 10);
        return Date.now() < until;
    },
    lockoutRemainingSeconds() {
        const until = parseInt(localStorage.getItem('ww_lockout_until') || '0', 10);
        return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    },
    registerFailure() {
        let count = parseInt(localStorage.getItem('ww_fail_count') || '0', 10) + 1;
        localStorage.setItem('ww_fail_count', String(count));
        if (count >= 5) {
            localStorage.setItem('ww_lockout_until', String(Date.now() + 60000)); // 60s lockout
            localStorage.setItem('ww_fail_count', '0');
        }
        return count;
    },
    registerSuccess() {
        localStorage.setItem('ww_fail_count', '0');
        localStorage.removeItem('ww_lockout_until');
    }
};
