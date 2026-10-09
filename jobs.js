let allJobs = [];
let filteredJobs = [];

function initFilters() {
    allJobs = WW.getJobs();
    filteredJobs = [...allJobs];

    const countries = [...new Set(allJobs.map(j => j.country))].sort();
    const cities = [...new Set(allJobs.map(j => j.city))].sort();
    const categories = [...new Set(allJobs.map(j => j.category))].sort();
    const industries = [...new Set(allJobs.map(j => j.industry))].sort();
    const types = [...new Set(allJobs.map(j => j.type))].sort();

    const fill = (id, arr, label) => {
        const el = document.getElementById(id);
        const current = el.value;
        while (el.options.length > 1) el.remove(1); // keep the "Any" option, clear the rest
        arr.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v; // textContent — safe from HTML injection by construction
            el.appendChild(opt);
        });
        if ([...el.options].some(o => o.value === current)) el.value = current; // preserve selection across live refresh
    };
    fill('filterCountry', countries);
    fill('filterCity', cities);
    fill('filterCategory', categories);
    fill('filterIndustry', industries);
    fill('filterType', types);

    applyFilters();
}

function prefillSearchFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) document.getElementById('searchInput').value = q;
}

function applyFilters() {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const country = document.getElementById('filterCountry').value;
    const city = document.getElementById('filterCity').value;
    const category = document.getElementById('filterCategory').value;
    const industry = document.getElementById('filterIndustry').value;
    const type = document.getElementById('filterType').value;
    const dateRange = document.getElementById('filterDate').value;

    filteredJobs = allJobs.filter(j => {
        if (q && !(j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.country.toLowerCase().includes(q) || j.city.toLowerCase().includes(q))) return false;
        if (country && j.country !== country) return false;
        if (city && j.city !== city) return false;
        if (category && j.category !== category) return false;
        if (industry && j.industry !== industry) return false;
        if (type && j.type !== type) return false;

        if (dateRange) {
            const days = parseInt(dateRange);
            const postedMatch = j.posted.match(/(\d+)/);
            const postedDays = postedMatch ? parseInt(postedMatch[1]) : 0;
            const unit = j.posted.includes('week') ? 7 : 1;
            if (postedDays * unit > days) return false;
        }

        return true;
    });

    renderJobs();
}

function renderJobs() {
    const list = document.getElementById('jobsList');
    const noResults = document.getElementById('noResults');
    const countEl = document.getElementById('jobsCount');

    if (filteredJobs.length === 0) {
        list.innerHTML = '';
        noResults.style.display = 'block';
        countEl.textContent = '0 jobs found';
        return;
    }

    noResults.style.display = 'none';
    countEl.textContent = `${filteredJobs.length} job${filteredJobs.length > 1 ? 's' : ''} found`;

    list.innerHTML = filteredJobs.map(j => `
        <div class="card job-card">
            <div class="card-body">
                <div class="job-title">${wwEsc(j.title)}</div>
                <div class="job-company"><i class="fas fa-building"></i> ${wwEsc(j.company)}</div>
                <div class="card-meta">
                    <span><i class="fas fa-map-marker-alt"></i>${wwEsc(j.city)}, ${wwEsc(j.country)}</span>
                    <span><i class="fas fa-clock"></i>${wwEsc(j.type)}</span>
                </div>
                <div class="job-tags">
                    <span class="tag tag-accent">${wwEsc(j.category)}</span>
                    <span class="tag">${wwEsc(j.industry)}</span>
                </div>
                <div class="card-price" style="font-size:1rem;">${wwEsc(j.salary)}</div>
                <div style="font-size:0.78rem;color:var(--muted);margin-bottom:12px;">
                    <i class="far fa-calendar-alt"></i> Deadline: ${wwEsc(j.deadline)} &nbsp;•&nbsp; Posted ${wwEsc(j.posted)}
                </div>
                <div class="card-actions">
                    <a href="job-detail.html?id=${encodeURIComponent(j.id)}" class="btn btn-outline btn-sm">View Job</a>
                    <a href="job-detail.html?id=${encodeURIComponent(j.id)}" class="btn btn-primary btn-sm">Apply Now</a>
                </div>
            </div>
        </div>
    `).join('');
}

document.addEventListener('DOMContentLoaded', () => { prefillSearchFromUrl(); initFilters(); });

// Live updates: if the admin publishes/edits a job from anywhere (their
// phone, another browser), everyone currently browsing this page sees it
// within moments, without a manual refresh — see WWSync in main.js.
document.addEventListener('ww:jobs-updated', initFilters);

// Live search on input
document.addEventListener('input', e => {
    if (e.target.id === 'searchInput') applyFilters();
});
document.addEventListener('change', e => {
    if (e.target.tagName === 'SELECT') applyFilters();
});