// ─── College Scorecard API ───────────────────────────────────────────────────
// Get a free key at: https://api.data.gov/signup/
const SCORECARD_API_KEY = '1VYFV5P6fgyPa24kdzuluVzK3ulMLhsQbGzApzVi';
const SCORECARD_URL = 'https://api.data.gov/ed/collegescorecard/v1/schools.json';
const SCORECARD_FIELDS = [
    'id',
    'school.name',
    'school.city',
    'school.state',
    'school.historically_black',
    'latest.student.size',
    'latest.admissions.admission_rate.overall',
    'latest.completion.completion_rate_4yr_150nt',
    'latest.cost.avg_net_price.public',
    'latest.cost.avg_net_price.private',
    'latest.earnings.10_yrs_after_entry.median',
    'latest.aid.median_debt.completers.overall',
    'latest.aid.pell_grant_rate',
    'latest.student.retention_rate.four_year.full_time',
    'latest.student.demographics.race_ethnicity.black',
    'latest.cost.net_price.public.by_income_level.0-30000',
    'latest.cost.net_price.public.by_income_level.30001-48000',
    'latest.cost.net_price.public.by_income_level.48001-75000',
    'latest.cost.net_price.public.by_income_level.75001-110000',
    'latest.cost.net_price.public.by_income_level.110001-plus',
    'latest.cost.net_price.private.by_income_level.0-30000',
    'latest.cost.net_price.private.by_income_level.30001-48000',
    'latest.cost.net_price.private.by_income_level.48001-75000',
    'latest.cost.net_price.private.by_income_level.75001-110000',
    'latest.cost.net_price.private.by_income_level.110001-plus',
    'school.school_url',
    'school.price_calculator_url'
].join(',');

/**
 * Fetches live data from the College Scorecard API.
 * Uses school.unitid if present (most reliable), otherwise searches by full name.
 * Results are cached in sessionStorage to avoid redundant calls.
 */
const SCORECARD_CACHE_VERSION = 'v3'; // bump when SCORECARD_FIELDS changes

async function fetchLiveStats(school) {
    const cacheKey = `scorecard_${SCORECARD_CACHE_VERSION}_${school.id}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);

    // Prefer unitid lookup — add "unitid": 131520 to colleges.json entries for reliability.
    // Without it, we search by name. Most official names match but some schools
    // (e.g. "Arizona State University Campus Immersion") may not resolve correctly.
    const query = school.unitid
        ? `id=${school.unitid}`
        : `school.name=${encodeURIComponent(school.full_name)}&per_page=1`;

    const res = await fetch(
        `${SCORECARD_URL}?${query}&api_key=${SCORECARD_API_KEY}&fields=${SCORECARD_FIELDS}`
    );
    if (!res.ok) throw new Error(`Scorecard API returned ${res.status}`);

    const data = await res.json();
    const result = data.results?.[0] || null;
    if (result) sessionStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
}

/**
 * Fetches campus feature data from the Urban Institute / IPEDS API.
 * Returns null if unitid is missing or the request fails.
 */
async function fetchCampusFeatures(unitid) {
    if (!unitid) return null;
    try {
        const res = await fetch(
            `https://educationdata.urban.org/api/v1/college-university/ipeds/institutional-characteristics/2020/?unitid=${unitid}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.results?.[0] || null;
    } catch (e) {
        return null;
    }
}

/** Formats a dollar amount, returning 'N/A' for null/undefined. */
function fmtDollars(val) {
    return val != null ? '$' + Number(val).toLocaleString() : 'N/A';
}

/** Formats a 0–1 decimal as a percentage, returning 'N/A' for null/undefined. */
function fmtPct(val) {
    return val != null ? (val * 100).toFixed(0) + '%' : 'N/A';
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Fetches college data and displays it in #scorecard-container.
 * manualKey overrides the ?school= URL param (used on dedicated school pages).
 */
async function initScorecard(manualKey) {
    const params = new URLSearchParams(window.location.search);
    const schoolId = manualKey || params.get('school');
    const displayArea = document.getElementById('scorecard-container');

    if (!schoolId || !displayArea) {
        if (displayArea) displayArea.innerHTML = '';
        return;
    }

    // Show a loading state immediately
    displayArea.innerHTML = `
        <div style="background:#f8f9fa; border:1px solid #e0e0e0; border-radius:12px; padding:20px; color:#888; font-size:0.85rem;">
            Loading stats...
        </div>`;

    try {
        // ── 1. Load local colleges.json (source of truth for IDs + fallback data) ──
        let jsonPath = 'js/colleges.json';
        let storiesPath = 'js/stories.json';
        let mobilityPath = 'js/mobility.json';

        if (window.location.pathname.includes('/pages/schools/')) {
            jsonPath = '../../js/colleges.json';
            storiesPath = '../../js/stories.json';
            mobilityPath = '../../js/mobility.json';
        } else if (window.location.pathname.includes('/pages/')) {
            jsonPath = '../js/colleges.json';
            storiesPath = '../js/stories.json';
            mobilityPath = '../js/mobility.json';
        }

        const localRes = await fetch(jsonPath);
        const colleges = await localRes.json();
        const local = colleges.find(c => c.id === schoolId);

        if (!local) {
            displayArea.innerHTML = '';
            return;
        }

        // ── 2. Update page title and hero text from local data immediately ──
        document.title = `${local.full_name} Profile — ScholarPath`;
        if (document.querySelector('.section-title')) {
            document.querySelector('.section-title').textContent = local.full_name;
        }

        // ── 3. Fetch live stats + campus features concurrently ──
        let live = null, campusFeatures = null;
        if (SCORECARD_API_KEY !== 'YOUR_API_KEY_HERE') {
            [live, campusFeatures] = await Promise.all([
                fetchLiveStats(local).catch(e => { console.warn('Scorecard API unavailable, using local data.', e.message); return null; }),
                fetchCampusFeatures(local.unitid)
            ]);
        }

        // ── 4. Merge: prefer live API data, fall back to local JSON ──
        const size         = live?.['latest.student.size']                        ?? local.size;
        const admitRate    = live?.['latest.admissions.admission_rate.overall']   ?? local.admission_rate;
        const gradRate     = live?.['latest.completion.completion_rate_4yr_150nt']?? local.grad_rate;
        const earnings     = live?.['latest.earnings.10_yrs_after_entry.median']  ?? null;
        const medianDebt   = live?.['latest.aid.median_debt.completers.overall']  ?? null;
        const city         = live?.['school.city']  ?? null;
        const state        = live?.['school.state'] ?? null;

        const pellRate      = live?.['latest.aid.pell_grant_rate']                           ?? null;
        const retentionRate = live?.['latest.student.retention_rate.four_year.full_time']  ?? null;
        const pctBlack      = live?.['latest.student.demographics.race_ethnicity.black']   ?? null;

        // For net price, the API splits by public/private ownership
        const netPrice = local.type === 'Public'
            ? (live?.['latest.cost.avg_net_price.public']   ?? local.price)
            : (live?.['latest.cost.avg_net_price.private']  ?? local.price);

        // ── 5. Update hero tagline with live location if available ──
        if (document.getElementById('school-tagline')) {
            const locationText = city && state ? `${city}, ${state}` : local.type + ' Institution';
            const sizeText = size ? size.toLocaleString() + ' Students' : 'Enrollment Pending';
            document.getElementById('school-tagline').textContent = `${locationText} · ${sizeText}`;
        }

        // ── 6. Render the stats scorecard ──
        const stats = [
            { label: 'TYPE',            value: local.type },
            { label: 'ENROLLMENT',      value: size ? size.toLocaleString() : 'N/A' },
            { label: 'ADMISSION RATE',  value: fmtPct(admitRate) },
            { label: 'GRAD RATE',       value: fmtPct(gradRate) },
            { label: 'RETENTION RATE',  value: fmtPct(retentionRate) },
            { label: 'PELL GRANT RATE', value: fmtPct(pellRate) },
            { label: 'AVG NET PRICE',   value: fmtDollars(netPrice) },
            { label: 'MEDIAN EARNINGS (10yr)', value: fmtDollars(earnings) },
            { label: 'MEDIAN DEBT',     value: fmtDollars(medianDebt) },
            { label: '% BLACK STUDENTS', value: fmtPct(pctBlack) },
        ];

        const schoolUrl = live?.['school.school_url'];
        const npcUrl    = live?.['school.price_calculator_url'];
        const schoolHref = schoolUrl
            ? (schoolUrl.startsWith('http') ? schoolUrl : 'https://' + schoolUrl)
            : null;
        const npcHref = npcUrl
            ? (npcUrl.startsWith('http') ? npcUrl : 'https://' + npcUrl)
            : null;

        displayArea.innerHTML = `
            <div style="background:#f8f9fa; border:1px solid #e0e0e0; border-radius:12px; padding:20px; margin-bottom:30px; font-family: 'DM Sans', sans-serif;">
                <h4 style="margin:0 0 12px 0; color:#185FA5; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px;">
                    Official Stats
                </h4>
                ${schoolHref ? `
                <a href="${schoolHref}" target="_blank" rel="noopener"
                   style="display:block;text-align:center;background:#c9a84c;color:#fff;border-radius:8px;padding:10px 16px;font-size:0.88rem;font-weight:600;text-decoration:none;margin-bottom:14px;letter-spacing:0.2px;">
                    Visit Official Site →
                </a>` : ''}
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
                    ${stats.map(({ label, value }) => `
                    <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #eee;">
                        <small style="color:#888; font-size:0.65rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${label}</small>
                        <strong style="color:#333; font-size:0.95rem;">${value}</strong>
                    </div>`).join('')}
                </div>
                ${live ? '<p style="margin-top:10px; font-size:0.7rem; color:#aaa;">Source: U.S. Dept. of Education College Scorecard</p>' : ''}
                ${(() => {
                    const links = [];
                    if (npcHref) {
                        links.push(`<a href="${npcHref}" target="_blank" rel="noopener"
                            style="display:inline-flex;align-items:center;gap:5px;background:#fff3e0;border:1px solid #f0c060;border-radius:8px;padding:7px 12px;font-size:0.78rem;color:#b45309;font-weight:500;text-decoration:none;white-space:nowrap;"
                            title="The school's official net price calculator — federally required">
                            🧮 Net Price Calculator
                        </a>`);
                    }
                    return links.length
                        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">${links.join('')}</div>`
                        : '';
                })()}
            </div>`;

        // ── 7. Load and display Opportunity Insights mobility data ──
        try {
            const mobilityRes = await fetch(mobilityPath);
            const mobilityData = await mobilityRes.json();
            const mob = mobilityData[schoolId];
            if (mob) {
                displayArea.innerHTML += `
                    <div style="background:#f8f9fa; border:1px solid #e0e0e0; border-radius:12px; padding:20px; margin-bottom:30px; font-family: 'DM Sans', sans-serif;">
                        <h4 style="margin:0 0 12px 0; color:#185FA5; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px;">
                            Economic Mobility
                        </h4>
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
                            ${[
                                { label: 'ACCESS RATE',          value: mob.access_rate != null ? mob.access_rate.toFixed(1) + '%' : 'N/A' },
                                { label: 'MOBILITY RATE',        value: mob.mobility_rate != null ? mob.mobility_rate.toFixed(1) + '%' : 'N/A' },
                                { label: 'MEDIAN PARENT INCOME', value: fmtDollars(mob.median_parent_income) },
                            ].map(({ label, value }) => `
                            <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #eee;">
                                <small style="color:#888; font-size:0.65rem; display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${label}</small>
                                <strong style="color:#333; font-size:0.95rem;">${value}</strong>
                            </div>`).join('')}
                        </div>
                        <p style="margin-top:10px; font-size:0.7rem; color:#aaa;">Access Rate = % students from bottom income quintile &middot; Mobility Rate = % who moved bottom&rarr;top quintile &middot; Source: Opportunity Insights</p>
                    </div>`;
            }
        } catch (e) {
            console.warn('Could not load mobility data.', e.message);
        }

        // ── 8. Render Urban Institute campus features ──
        if (campusFeatures) {
            const featureList = [
                { label: 'Campus Housing',  on: campusFeatures.oncampus_housing === 1 },
                { label: 'Study Abroad',    on: campusFeatures.study_abroad === 1 },
                { label: 'Online Programs', on: campusFeatures.dist_progs_offered === 1 },
                { label: "Bachelor's",      on: campusFeatures.bach_offered === 1 },
                { label: "Master's",        on: campusFeatures.masters_offered === 1 },
                { label: 'Doctoral',        on: campusFeatures.doctors_research_offered === 1 },
                { label: 'NCAA Athletics',  on: campusFeatures.member_ncaa === 1 },
            ].filter(f => f.on);
            if (featureList.length) {
                displayArea.innerHTML += `
                    <div style="background:#f8f9fa; border:1px solid #e0e0e0; border-radius:12px; padding:20px; margin-bottom:30px; font-family: 'DM Sans', sans-serif;">
                        <h4 style="margin:0 0 12px 0; color:#185FA5; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px;">
                            Campus Features
                        </h4>
                        <div style="display:flex; flex-wrap:wrap; gap:8px;">
                            ${featureList.map(f => `<span style="background:#e8f0fb; color:#185FA5; border-radius:20px; padding:4px 12px; font-size:0.8rem;">${f.label}</span>`).join('')}
                        </div>
                        <p style="margin-top:10px; font-size:0.7rem; color:#aaa;">Source: Urban Institute / IPEDS (2020)</p>
                    </div>`;
            }
        }

        // ── 9. Render net price calculator ──
        const calcContainer = document.getElementById('net-price-container');
        if (calcContainer && live) {
            const prefix = local.type === 'Public'
                ? 'latest.cost.net_price.public.by_income_level'
                : 'latest.cost.net_price.private.by_income_level';
            const brackets = [
                { label: 'Under $30,000',       key: `${prefix}.0-30000` },
                { label: '$30,001 – $48,000',   key: `${prefix}.30001-48000` },
                { label: '$48,001 – $75,000',   key: `${prefix}.48001-75000` },
                { label: '$75,001 – $110,000',  key: `${prefix}.75001-110000` },
                { label: 'Over $110,000',        key: `${prefix}.110001-plus` },
            ].filter(b => live[b.key] != null);

            if (brackets.length) {
                calcContainer.innerHTML = `
                    <div style="background:#f8f9fa; border:1px solid #e0e0e0; border-radius:12px; padding:20px; font-family:'DM Sans',sans-serif;">
                        <h4 style="margin:0 0 6px 0; color:#185FA5; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px;">Net Price Calculator</h4>
                        <p style="margin:0 0 12px 0; font-size:0.75rem; color:#888; line-height:1.5;">What will ${local.full_name} actually cost your family?</p>
                        <label style="font-size:0.78rem; color:#555; font-weight:500;">Family income (before taxes)</label>
                        <select id="npc-income" style="width:100%; margin-top:6px; margin-bottom:12px; padding:8px 10px; border-radius:8px; border:1px solid #ddd; font-family:'DM Sans',sans-serif; font-size:0.85rem; background:#fff;">
                            <option value="">Select your income range…</option>
                            ${brackets.map((b, i) => `<option value="${i}">${b.label}</option>`).join('')}
                        </select>
                        <div id="npc-result" style="display:none; background:#fff; border:1px solid #eee; border-radius:8px; padding:14px; text-align:center;">
                            <div style="font-size:1.6rem; font-weight:700; color:#185FA5;" id="npc-price"></div>
                            <div style="font-size:0.72rem; color:#aaa; margin-top:4px;">avg. net price · after grants &amp; scholarships · not loans</div>
                        </div>
                        <p style="margin:10px 0 0 0; font-size:0.68rem; color:#bbb;">Source: U.S. Dept. of Education College Scorecard</p>
                    </div>`;

                const select = calcContainer.querySelector('#npc-income');
                const result = calcContainer.querySelector('#npc-result');
                const priceEl = calcContainer.querySelector('#npc-price');
                select.addEventListener('change', () => {
                    const idx = select.value;
                    if (idx === '') { result.style.display = 'none'; return; }
                    const val = live[brackets[idx].key];
                    priceEl.textContent = fmtDollars(val) + ' / yr';
                    result.style.display = 'block';
                });
            }
        }

        // ── 10. Load and display stories ──
        const storiesRes = await fetch(storiesPath);
        const stories = await storiesRes.json();
        const hasRealStory = !!stories[schoolId];
        const story = stories[schoolId] || stories['default'];

        if (document.getElementById('real-talk-1')) {
            document.getElementById('real-talk-1').textContent = story.brochure;
            document.getElementById('real-talk-2').textContent = story.wish;
            document.getElementById('real-talk-3').textContent = story.roi;

            if (hasRealStory) {
                ['real-talk-1', 'real-talk-2', 'real-talk-3'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) { el.style.color = ''; el.style.fontStyle = ''; }
                });
            } else {
                ['cta-1', 'cta-2', 'cta-3'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'block';
                });
            }
        }

    } catch (error) {
        console.error('Scorecard Load Error:', error);
        displayArea.innerHTML = '<p style="color:#888; font-size:0.85rem; padding:1rem;">Could not load stats. Please try again.</p>';
    }
}

// Run on direct page loads (e.g. template.html?school=howard)
window.addEventListener('DOMContentLoaded', () => initScorecard());
