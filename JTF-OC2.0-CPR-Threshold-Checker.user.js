// ==UserScript==
// @name         JTF OC2.0 CPR Threshold Checker
// @namespace    https://torn.com/
// @version      2.0
// @description  Shows eligibility based on CPR thresholds and recommends the best available OC role using profitability and live planning urgency
// @author       SiliconRain
// @match        https://www.torn.com/factions.php?step=your*
// @updateURL    https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @downloadURL  https://raw.githubusercontent.com/SiliconRain/JTF-OC2-Threshold-Checker/refs/heads/main/JTF-OC2.0-CPR-Threshold-Checker.user.js
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[JTF OC Recommendations]', ...args);
    const warn = (...args) => console.warn('[JTF OC Recommendations]', ...args);

    const YELLOW_ADJUSTMENT = 5;
    const UNKNOWN_THRESHOLD = -1;
    const SORT_PREFERENCE_KEY = 'jtfOcRecommendedSort';

    const SCORE_CONFIG = Object.freeze({
        timingFloor: 0.25,
        timingHalfLifeHours: 24,
        pausedBoostPerMember: 0.25,
        emptyExpiringBaseBoost: 0.25,
        emptyExpiringUrgencyBoost: 0.15,
        maximumStateMultiplier: 2.5
    });

    const THRESHOLDS_CSV_URL =
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vSYqL3ZcxOPexCFM5LcmnEu_mBNfWD1P5k6xTOAHVKFhQaHGUdU24y3Oh1O1sxzpTqEEBBV3kE8bi6L/pub?output=csv';
    const PROFITABILITY_CSV_URL =
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfGqcPZrenn07bleAyV1GszclfKq0FCXMcAbfdRIL7qt4nmRtVae0XhfXI0nxqounpgKg9LYxgHQ2-/pub?gid=1133613060&single=true&output=csv';

    let referenceDataPromise = null;
    let referenceData = null;
    let processRunning = false;
    let processRequested = false;
    let debounceTimeout = null;
    let nextOriginalOrder = 0;
    let recommendedSortEnabled = readSortPreference();

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function canonicalKey(value) {
        return normalizeText(value).toLocaleLowerCase();
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function parseNumber(value) {
        const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    // Quote-aware CSV parser. The profitability sheet contains quoted currency
    // values with embedded commas, so a simple line.split(',') is not sufficient.
    function parseCSV(csvText) {
        const text = String(csvText ?? '').replace(/^\uFEFF/, '');
        const table = [];
        let row = [];
        let field = '';
        let insideQuotes = false;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];

            if (char === '"') {
                if (insideQuotes && text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                row.push(field);
                field = '';
            } else if ((char === '\n' || char === '\r') && !insideQuotes) {
                if (char === '\r' && text[i + 1] === '\n') i += 1;
                row.push(field);
                field = '';
                if (row.some(cell => cell !== '')) table.push(row);
                row = [];
            } else {
                field += char;
            }
        }

        if (insideQuotes) throw new Error('CSV ended inside a quoted field');
        if (field !== '' || row.length > 0) {
            row.push(field);
            if (row.some(cell => cell !== '')) table.push(row);
        }
        if (table.length === 0) return [];

        const headers = table.shift().map(normalizeText);
        return table.map(values => {
            const record = {};
            headers.forEach((header, index) => {
                record[header] = normalizeText(values[index] ?? '');
            });
            return record;
        });
    }

    function requestText(url, label) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 30000,
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`${label} returned HTTP ${response.status}`));
                    }
                },
                onerror: error => reject(new Error(`${label} request failed: ${String(error)}`)),
                ontimeout: () => reject(new Error(`${label} request timed out`))
            });
        });
    }

    function buildThresholdIndex(rows) {
        const index = new Map();

        for (const row of rows) {
            const crimeKey = canonicalKey(row.Crime);
            const roleKey = canonicalKey(row.Role);
            if (!crimeKey || !roleKey) continue;
            if (!index.has(crimeKey)) index.set(crimeKey, new Map());
            index.get(crimeKey).set(roleKey, row);
        }

        return index;
    }

    function buildProfitabilityMap(rows) {
        const map = new Map();
        const profitHeader = 'Profit $ per Planning Hour (ideal)';

        // Load ordinary rows first.
        for (const row of rows) {
            const crimeKey = canonicalKey(row.Crime);
            const profit = parseNumber(row[profitHeader]);
            if (crimeKey && profit !== null) {
                map.set(crimeKey, {
                    profit,
                    source: normalizeText(row.Crime),
                    isCombination: false
                });
            }
        }

        // Combination rows override both component crimes, as the two crimes
        // form one economic outcome and must use their combined ideal PPH.
        for (const row of rows) {
            const isCombination = canonicalKey(row['Is Combo?']) === 'true';
            if (!isCombination) continue;

            const profit = parseNumber(row[profitHeader]);
            if (profit === null) continue;

            const source = normalizeText(row.Crime);
            for (const crimeName of [row.Crime, row['Crime 1'], row['Crime 2']]) {
                const crimeKey = canonicalKey(crimeName);
                if (!crimeKey) continue;
                map.set(crimeKey, { profit, source, isCombination: true });
            }
        }

        return map;
    }

    async function loadReferenceData() {
        if (referenceData) return referenceData;
        if (referenceDataPromise) return referenceDataPromise;

        referenceDataPromise = Promise.all([
            requestText(THRESHOLDS_CSV_URL, 'Threshold CSV'),
            requestText(PROFITABILITY_CSV_URL, 'Profitability CSV')
        ]).then(([thresholdText, profitabilityText]) => {
            const thresholdRows = parseCSV(thresholdText);
            const profitabilityRows = parseCSV(profitabilityText);
            referenceData = {
                thresholdIndex: buildThresholdIndex(thresholdRows),
                profitabilityMap: buildProfitabilityMap(profitabilityRows)
            };
            log(`Loaded ${thresholdRows.length} threshold rows and ${profitabilityRows.length} profitability rows`);
            return referenceData;
        }).catch(error => {
            referenceDataPromise = null;
            throw error;
        });

        return referenceDataPromise;
    }

    function getThreshold(crime, level, role, isYellow, isNotStarted) {
        const index = referenceData?.thresholdIndex;
        if (!index) return null;

        const crimeRows = index.get(canonicalKey(crime));
        let match = crimeRows?.get(canonicalKey(role));

        if (!match) match = crimeRows?.get(canonicalKey('All roles'));

        if (!match) {
            match = index
                .get(canonicalKey('All other crimes'))
                ?.get(canonicalKey('All roles'));

            if (!match) return null;
            if (level > 2) return UNKNOWN_THRESHOLD;
        }

        const defaultThreshold = parseNumber(match.DefaultThreshold);
        if (defaultThreshold === null) return null;

        const unstartedThreshold = parseNumber(match.UnstartedThreshold);
        const baseThreshold = isNotStarted && unstartedThreshold !== null
            ? unstartedThreshold
            : defaultThreshold;
        const adjustment = isYellow && defaultThreshold !== 101 ? YELLOW_ADJUSTMENT : 0;

        return baseThreshold - adjustment;
    }

    function readSortPreference() {
        try {
            const stored = localStorage.getItem(SORT_PREFERENCE_KEY);
            return stored === null ? true : stored === 'true';
        } catch (_) {
            return true;
        }
    }

    function saveSortPreference() {
        try {
            localStorage.setItem(SORT_PREFERENCE_KEY, String(recommendedSortEnabled));
        } catch (_) {
            // The feature still works for this page even if storage is unavailable.
        }
    }

    function setStyles(element, styles) {
        for (const [property, value] of Object.entries(styles)) {
            if (element.style[property] !== value) element.style[property] = value;
        }
    }

    function setText(element, text) {
        if (element.textContent !== text) element.textContent = text;
    }

    function showLoadingBanner(container, text = 'Loading JTF OC recommendations... ⏳') {
        let banner = document.getElementById('oc-threshold-loading');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'oc-threshold-loading';
            container.prepend(banner);
        }

        setText(banner, text);
        setStyles(banner, {
            background: '#1f1f1f',
            color: '#ccc',
            padding: '8px',
            marginBottom: '10px',
            textAlign: 'center',
            fontWeight: 'bold',
            border: '1px solid #333',
            borderRadius: '4px'
        });
        return banner;
    }

    function showLoadError(container, error) {
        const banner = showLoadingBanner(container, 'Unable to load JTF OC recommendation data ⚠️');
        banner.title = error?.message || String(error);
        setStyles(banner, {
            color: '#ffb347',
            borderColor: '#8a5b20'
        });
    }

    function removeLoadingBanner() {
        document.getElementById('oc-threshold-loading')?.remove();
    }

    function updateSortButton(button) {
        setText(button, recommendedSortEnabled ? 'Recommended order: ON' : 'Recommended order: OFF');
        button.title = recommendedSortEnabled
            ? 'OCs are sorted by JTF recommendation priority. Click to restore Torn order.'
            : 'OCs are in Torn order. Click to sort by JTF recommendation priority.';
        setStyles(button, {
            background: recommendedSortEnabled ? '#315b28' : '#333',
            color: '#fff',
            border: '1px solid #777',
            borderRadius: '4px',
            cursor: 'pointer',
            padding: '5px 9px',
            fontSize: '12px',
            fontWeight: 'bold'
        });
    }

    function ensureSortControls(container) {
        let controls = document.getElementById('oc-recommendation-controls');
        if (controls) {
            updateSortButton(controls.querySelector('button'));
            return controls;
        }

        controls = document.createElement('div');
        controls.id = 'oc-recommendation-controls';
        setStyles(controls, {
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            marginBottom: '8px'
        });

        const button = document.createElement('button');
        button.type = 'button';
        updateSortButton(button);
        button.addEventListener('click', () => {
            recommendedSortEnabled = !recommendedSortEnabled;
            saveSortPreference();
            updateSortButton(button);
            scheduleProcess(0);
        });

        controls.append(button);
        container.prepend(controls);
        return controls;
    }

    function findCrimeState(crimeDiv) {
        const stateElement = Array.from(crimeDiv.querySelectorAll('[aria-label]')).find(element => {
            const label = canonicalKey(element.getAttribute('aria-label'));
            return ['active', 'recruiting', 'paused', 'expiring'].includes(label) &&
                String(element.className).includes('iconContainer');
        });

        return canonicalKey(stateElement?.getAttribute('aria-label'));
    }

    function hasClassFragment(root, fragment) {
        return Boolean(root.querySelector(`[class*="${fragment}"]`));
    }

    function parseDurationHours(value) {
        const text = canonicalKey(value);
        if (!text) return null;

        const read = unit => {
            const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`));
            return match ? Number.parseFloat(match[1]) : 0;
        };

        const days = read('day');
        const hours = read('hour');
        const minutes = read('minute');
        const seconds = read('second');
        const total = (days * 24) + hours + (minutes / 60) + (seconds / 3600);
        return Number.isFinite(total) ? total : null;
    }

    function getSlotElements(crimeDiv) {
        const seen = new Set();
        const slots = [];

        for (const header of crimeDiv.querySelectorAll('button[class^="slotHeader"]')) {
            const slot = header.closest('div[class^="wrapper"]');
            if (!slot || seen.has(slot)) continue;
            seen.add(slot);
            slots.push(slot);
        }

        return slots;
    }

    function getPlanningProgress(slot, isOpen) {
        if (isOpen) return null;

        const planningClock = slot.querySelector('[class^="planning"]');
        if (planningClock) {
            const styleText = planningClock.getAttribute('style') || planningClock.style.background || '';
            const degreeMatch = styleText.match(/([0-9]+(?:\.[0-9]+)?)deg/i);
            if (degreeMatch) return clamp(Number.parseFloat(degreeMatch[1]) / 360, 0, 1);
        }

        // Torn uses an inactive icon for an occupied role that has not yet made
        // planning progress. Treat an otherwise unknown occupied state as 0% so
        // the script does not underestimate the time before the OC will pause.
        return 0;
    }

    function parseSlot(slot) {
        const header = slot.querySelector('button[class^="slotHeader"]');
        const role = normalizeText(header?.querySelector('[class^="title"]')?.textContent);
        const chance = parseNumber(header?.querySelector('[class^="successChance"]')?.textContent);
        const isOpen = String(slot.className).includes('waitingJoin');

        return {
            element: slot,
            role,
            chance,
            isOpen,
            progress: getPlanningProgress(slot, isOpen),
            threshold: null,
            eligible: false
        };
    }

    function getOriginalOrder(crimeDiv) {
        const id = crimeDiv.getAttribute('data-oc-id') || '';
        const existing = crimeDiv.dataset.ocOriginalOrder;
        if (existing !== undefined) return Number(existing);

        const order = nextOriginalOrder;
        nextOriginalOrder += 1;
        crimeDiv.dataset.ocOriginalOrder = String(order);
        log('Recorded original order', id, order);
        return order;
    }

    function chooseBestRole(eligibleSlots) {
        return [...eligibleSlots].sort((a, b) =>
            (b.threshold - a.threshold) ||
            (b.chance - a.chance)
        )[0] || null;
    }

    function parseCrime(crimeDiv) {
        const titleElement = crimeDiv.querySelector('p[class^="panelTitle"]');
        const crimeTitle = normalizeText(titleElement?.textContent);
        const level = parseNumber(crimeDiv.querySelector('[class^="levelValue"]')?.textContent);
        if (!crimeTitle || level === null) return null;

        const slots = getSlotElements(crimeDiv).map(parseSlot);
        if (slots.length === 0) return null;

        const filledSlots = slots.filter(slot => !slot.isOpen);
        const openSlots = slots.filter(slot => slot.isOpen && slot.role && slot.chance !== null);
        const state = findCrimeState(crimeDiv);
        const isPaused = state === 'paused' || hasClassFragment(crimeDiv, 'paused');
        const isExpiring = state === 'expiring' || hasClassFragment(crimeDiv, 'expiring');
        const isNotStarted = filledSlots.length === 0;
        const isYellow = isPaused || isExpiring;

        for (const slot of openSlots) {
            slot.threshold = getThreshold(
                crimeTitle,
                level,
                slot.role,
                isYellow,
                isNotStarted
            );
            slot.eligible = slot.threshold !== null &&
                slot.threshold !== UNKNOWN_THRESHOLD &&
                slot.threshold !== 101 &&
                slot.chance >= slot.threshold;
        }

        const eligibleSlots = openSlots.filter(slot => slot.eligible);
        const selectedRole = chooseBestRole(eligibleSlots);
        const profitability = referenceData.profitabilityMap.get(canonicalKey(crimeTitle)) || null;

        const hoursUntilPause = isPaused || filledSlots.length === 0
            ? 0
            : filledSlots.reduce((total, slot) => total + (24 * (1 - slot.progress)), 0);
       
        const timingNeutralHours = 1.5; //with how many hours remaining before the OC pauses is the priority of this OC equal to an OC that's not yet started?
        const timingFactor = isPaused || filledSlots.length === 0
            ? 1
            : SCORE_CONFIG.timingFloor +
              ((1 - SCORE_CONFIG.timingFloor) *
               (2 ** ((timingNeutralHours - hoursUntilPause) /
                      SCORE_CONFIG.timingHalfLifeHours)));

        const pausedRescueFactor = isPaused
            ? 1 + (SCORE_CONFIG.pausedBoostPerMember * filledSlots.length)
            : 1;

        const countdownElement = crimeDiv.querySelector('[class^="title"][aria-label]');
        const hoursUntilExpiry = parseDurationHours(countdownElement?.getAttribute('aria-label'));
        let expiryFactor = 1;
        if (isExpiring && filledSlots.length === 0) {
            const expiryUrgency = hoursUntilExpiry === null
                ? 0
                : clamp(1 - (hoursUntilExpiry / 24), 0, 1);
            expiryFactor = 1 +
                SCORE_CONFIG.emptyExpiringBaseBoost +
                (SCORE_CONFIG.emptyExpiringUrgencyBoost * expiryUrgency);
        }

        const uncappedStateMultiplier = timingFactor * pausedRescueFactor * expiryFactor;
        const stateMultiplier = Math.min(
            SCORE_CONFIG.maximumStateMultiplier,
            uncappedStateMultiplier
        );

        const canRank = Boolean(selectedRole && profitability && profitability.profit > 0);
        const priority = canRank ? profitability.profit * stateMultiplier : null;

        return {
            element: crimeDiv,
            titleElement,
            crimeTitle,
            level,
            state,
            isPaused,
            isExpiring,
            isNotStarted,
            slots,
            filledCount: filledSlots.length,
            openCount: openSlots.length,
            selectedRole,
            profitability,
            hoursUntilPause,
            hoursUntilExpiry,
            timingFactor,
            pausedRescueFactor,
            expiryFactor,
            stateMultiplier,
            priority,
            canRank,
            originalOrder: getOriginalOrder(crimeDiv),
            rank: null
        };
    }

    function rankCrimes(crimes) {
        const ranked = crimes.filter(crime => crime.canRank).sort((a, b) =>
            (b.priority - a.priority) ||
            (b.profitability.profit - a.profitability.profit) ||
            (b.selectedRole.threshold - a.selectedRole.threshold) ||
            (a.hoursUntilPause - b.hoursUntilPause) ||
            (a.originalOrder - b.originalOrder)
        );

        ranked.forEach((crime, index) => {
            crime.rank = index + 1;
        });
        return ranked;
    }

    function formatMoney(value) {
        return `$${Math.round(value).toLocaleString()}`;
    }

    function formatHours(value) {
        if (!Number.isFinite(value)) return 'unknown time';
        if (value < 1) return `${Math.max(1, Math.round(value * 60))}m`;
        if (value < 10) return `${value.toFixed(1)}h`;
        return `${Math.round(value)}h`;
    }

    function describeCrimeTiming(crime) {
        if (crime.isPaused) {
            return `paused · ${crime.filledCount} member${crime.filledCount === 1 ? '' : 's'} waiting`;
        }
        if (crime.filledCount === 0) {
            return crime.isExpiring ? 'empty and expiring' : 'planning starts now';
        }
        return `${formatHours(crime.hoursUntilPause)} until pause`;
    }

    function renderSlotNote(slot, selectedRank) {
        let note = slot.element.querySelector('.oc-threshold');
        if (!note) {
            note = document.createElement('div');
            note.className = 'oc-threshold';
            slot.element.prepend(note);
        }

        setStyles(note, {
            fontSize: '12px',
            fontWeight: 'bold',
            textAlign: 'center',
            whiteSpace: 'pre-line'
        });

        let prefix = '';
        if (selectedRank === 1) prefix = '🥇 BEST ROLE!\n';
        else if (selectedRank === 2) prefix = '🥈 GOOD ROLE\n';
        else if (selectedRank === 3) prefix = '🥉 GOOD ROLE\n';
        else prefix = '✅ OK\n';

        if (slot.threshold === null) {
            setText(note, '⚠️\nThreshold unavailable');
            note.style.color = 'orange';
        } else if (slot.threshold === UNKNOWN_THRESHOLD) {
            setText(note, '⚠️\nNot yet defined');
            note.style.color = 'orange';
        } else if (slot.threshold === 101) {
            setText(note, '❌❌❌\n(Do Not Join!)');
            note.style.color = '#cc0000';
        } else if (slot.eligible) {
            setText(note, `${prefix}(Requires ≥ ${slot.threshold})`);
            note.style.color = selectedRank > 0 && selectedRank < 4 ? '#ffe066' : 'limegreen';
        } else {
            setText(note, `❌ Too low\n(Requires ≥ ${slot.threshold})`);
            note.style.color = '#cc0000';
        }

        const isRecommended = selectedRank && selectedRank <= 3;
        const isBest = selectedRank === 1;
        setStyles(note, {
            background: isRecommended
                ? (isBest ? 'rgba(175, 135, 0, 0.24)' : 'rgba(60, 100, 60, 0.18)')
                : '',
            border: isRecommended
                ? (isBest ? '1px solid #d6ad28' : '1px solid #517a51')
                : '',
            borderRadius: isRecommended ? '4px' : '',
            padding: isRecommended ? '3px' : '',
            margin: isRecommended ? '2px' : ''
        });
    }

    function renderCrimeBanner(crime) {
        let banner = crime.element.querySelector('.oc-priority-banner');

        if (!crime.rank || crime.rank > 3) {
            banner?.remove();
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'oc-priority-banner';
            crime.titleElement.insertAdjacentElement('afterend', banner);
        }

        const label = crime.rank === 1 ? '⭐ BEST OC' : `#${crime.rank} RECOMMENDED`;
        const text = `${label} · ${crime.selectedRole.role} · ` + describeCrimeTiming(crime);

        setText(banner, text);
        setStyles(banner, {
            color: crime.rank === 1 ? '#ffe066' : '#b7e4a8',
            background: crime.rank === 1 ? 'rgba(175, 135, 0, 0.20)' : 'rgba(45, 85, 45, 0.17)',
            border: crime.rank === 1 ? '1px solid #b89218' : '1px solid #466746',
            borderRadius: '4px',
            padding: '4px 6px',
            margin: '3px 0 5px',
            fontSize: '11px',
            fontWeight: 'bold',
            lineHeight: '1.25'
        });
        const tooltip = `Priority score: ${Math.round(crime.priority).toLocaleString()}\n` +
            `Timing ×${crime.timingFactor.toFixed(2)}, ` +
            `paused rescue ×${crime.pausedRescueFactor.toFixed(2)}, ` +
            `expiry ×${crime.expiryFactor.toFixed(2)}`;
        if (banner.title !== tooltip) banner.title = tooltip;
    }

    function renderCrimes(crimes) {
        for (const crime of crimes) {
            renderCrimeBanner(crime);
            for (const slot of crime.slots.filter(item => item.isOpen)) {
                const selectedRank = slot === crime.selectedRole ? crime.rank : null;
                renderSlotNote(slot, selectedRank);
            }
        }
    }

    function sortCrimeCards(crimes) {
        const groupedByParent = new Map();

        for (const crime of crimes) {
            const parent = crime.element.parentElement;
            if (!parent) continue;
            if (!groupedByParent.has(parent)) groupedByParent.set(parent, []);
            groupedByParent.get(parent).push(crime);
        }

        for (const [parent, group] of groupedByParent) {
            const target = [...group].sort((a, b) => {
                if (!recommendedSortEnabled) return a.originalOrder - b.originalOrder;
                if (a.canRank && b.canRank) return a.rank - b.rank;
                if (a.canRank !== b.canRank) return a.canRank ? -1 : 1;
                return a.originalOrder - b.originalOrder;
            });

            const display = getComputedStyle(parent).display;
            const supportsOrder = display.includes('flex') || display.includes('grid');

            if (supportsOrder) {
                target.forEach((crime, index) => {
                    const order = String(index);
                    if (crime.element.style.order !== order) crime.element.style.order = order;
                });
                continue;
            }

            group.forEach(crime => {
                if (crime.element.style.order) crime.element.style.order = '';
            });

            const current = Array.from(parent.children)
                .filter(element => element.matches?.('div[data-oc-id]'));
            const alreadySorted = current.length === target.length &&
                current.every((element, index) => element === target[index].element);

            if (!alreadySorted) target.forEach(crime => parent.appendChild(crime.element));
        }
    }

    async function processOCPage() {
        if (processRunning) {
            processRequested = true;
            return;
        }

        processRunning = true;
        try {
            await loadReferenceData();

            const crimeDivs = Array.from(document.querySelectorAll('div[data-oc-id]'));
            const crimes = crimeDivs.map(parseCrime).filter(Boolean);
            const ranked = rankCrimes(crimes);
            log('Ranked OCs', ranked.map(crime => ({
                rank: crime.rank,
                crime: crime.crimeTitle,
                role: crime.selectedRole.role,
                priority: Math.round(crime.priority),
                stateMultiplier: Number(crime.stateMultiplier.toFixed(3))
            })));

            renderCrimes(crimes);
            sortCrimeCards(crimes);
        } catch (error) {
            warn('Failed to process OC page', error);
            const container = document.querySelector('div.organize-wrap');
            if (container) showLoadError(container, error);
        } finally {
            processRunning = false;
            if (processRequested) {
                processRequested = false;
                scheduleProcess(0);
            }
        }
    }

    function scheduleProcess(delay = 600) {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            debounceTimeout = null;
            processOCPage();
        }, delay);
    }

    function waitForOrganizeWrap(callback) {
        const existing = document.querySelector('div.organize-wrap');
        if (existing) {
            callback(existing);
            return;
        }

        const bodyObserver = new MutationObserver((mutations, observer) => {
            const element = document.querySelector('div.organize-wrap');
            if (!element) return;
            observer.disconnect();
            callback(element);
        });

        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    waitForOrganizeWrap(organizedWrap => {
        showLoadingBanner(organizedWrap);

        const observer = new MutationObserver(() => scheduleProcess());
        observer.observe(organizedWrap, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-label']
        });

        loadReferenceData().then(() => {
            removeLoadingBanner();
            ensureSortControls(organizedWrap);
            scheduleProcess(0);
        }).catch(error => {
            warn('Failed to load reference data', error);
            showLoadError(organizedWrap, error);
        });
    });
})();
