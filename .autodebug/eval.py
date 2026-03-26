#!/usr/bin/env python3
"""
AutoDebug eval harness — FLIP CAM System Evolution v1
Checks: DOM refs, function defs, state sync, CSS conflicts, localStorage keys.
Exit 0 = all critical checks pass. Exit 1 = critical failure found.
"""
import re, sys

html = open('webapp/index.html').read()
errors   = []  # critical
warnings = []  # non-critical

def check(label, condition, critical=True):
    if not condition:
        (errors if critical else warnings).append(label)

# ── 1. Function definitions ────────────────────────────────────────
REQUIRED_FUNS = [
    'renderDithered', 'renderDolphin', 'renderCaskia', 'renderVFD',
    '_applyCamState', '_buildCaskiaOverlay', '_buildVFDOverlay',
    '_buildDolphinScanlines', 'flipToast', '_toggleCamera',
    '_saveCustomSlots', '_loadCustomSlots', '_renderCustomSlots',
    'saveSettings', 'loadSettings', 'startCamera', 'cameraLoop',
    'cropCoords', 'switchTab',
]
for fn in REQUIRED_FUNS:
    check(f'function {fn} missing', f'function {fn}' in html)

# ── 2. DOM IDs referenced in JS must exist in HTML ─────────────────
REQUIRED_IDS = [
    'camFamilyStrip', 'camVariantPill', 'dlpEditPanel', 'palCustomSlots',
    'btnSwitchCam', 'btnFlip', 'btnCapture', 'btnRecord', 'btnShare',
    'dlpReso', 'dlpContr', 'vDlpReso', 'vDlpContr',
    'palFreeInk', 'palFreePaper', 'palFreeBox', 'palColorTabs',
    'btnPalClassic', 'btnPalFree', 'btnMode', 'btnDolphin',
    'scrashControls', 'scrashControlsGrid', 'advanced-scrash',
    'barCam', 'camFpsCtrl', 'camAspect', 'palettes',
    'flipBottomNav', 'flipExportBar',
]
for eid in REQUIRED_IDS:
    check(f'id="{eid}" missing in HTML', f'id="{eid}"' in html)

# ── 3. CSS classes referenced in JS must exist in CSS ─────────────
REQUIRED_CLASSES = [
    'cam-fam-btn', 'cam-var-btn', 'pcs-slot', 'dlp-col-btn',
    'dlp-ctrl-row', 'dlp-lbl', 'dlp-val', 'dlp-col-row',
    'cam-color-hidden', 'dlp-lgcy-mode', 'dolphin-mode',
    'caskia-mode', 'vfd-mode', 'dlp-warm-mode',
]
for cls in REQUIRED_CLASSES:
    check(f'CSS class .{cls} missing', f'.{cls}' in html or f'{cls}' in html)

# ── 4. CAM_FAMILIES registry check ────────────────────────────────
check('CAM_FAMILIES defined', 'const CAM_FAMILIES' in html)
for fam in ['DSI', 'DLPHN', 'CASKIA', 'VFD']:
    check(f'CAM_FAMILIES.{fam} entry', f"'{fam}'" in html or f'"{fam}"' in html)

# ── 5. cameraLoop dispatches all families ─────────────────────────
check("cameraLoop dispatches DLPHN",  "camFamily === 'DLPHN'" in html)
check("cameraLoop dispatches CASKIA", "camFamily === 'CASKIA'" in html)
check("cameraLoop dispatches VFD",    "camFamily === 'VFD'" in html)

# ── 6. Overlay builders called on resize ──────────────────────────
check('_buildCaskiaOverlay called on resize', '_buildCaskiaOverlay()' in html and html.count('_buildCaskiaOverlay()') >= 2)
check('_buildVFDOverlay called on resize',    '_buildVFDOverlay()' in html    and html.count('_buildVFDOverlay()') >= 2)

# ── 7. saveSettings includes camFamily/camVariant ─────────────────
check('saveSettings persists camFamily',  'camFamily' in html[html.find('function saveSettings'):html.find('function saveSettings')+500])
check('saveSettings persists camVariant', 'camVariant' in html[html.find('function saveSettings'):html.find('function saveSettings')+500])

# ── 8. GLITCH overflow fix applied ────────────────────────────────
check('GLITCH overflow:hidden removed', 'overflow:hidden' not in html[html.find('#scrashControls'):html.find('#scrashControls')+400])
check('GLITCH overflow-y:auto present', 'overflow-y:auto' in html[html.find('#scrashControls'):html.find('#scrashControls')+400])

# ── 9. _applyCamState syncs all body themes ───────────────────────
apply_block = html[html.find('function _applyCamState'):html.find('function _applyCamState')+800]
check('_applyCamState toggles dolphin-mode',  "'dolphin-mode'" in apply_block)
check('_applyCamState toggles dlp-lgcy-mode', "'dlp-lgcy-mode'" in apply_block)
check('_applyCamState toggles caskia-mode',   "'caskia-mode'" in apply_block)
check('_applyCamState toggles vfd-mode',      "'vfd-mode'" in apply_block)

# ── 10. switchTab calls _applyCamState on cam ─────────────────────
switchwrap = html[html.find('Wrap switchTab'):html.find('Wrap switchTab')+600]
check("switchTab wrapper calls _applyCamState on 'cam'", '_applyCamState' in switchwrap)

# ── 11. localStorage keys don't collide ───────────────────────────
check('flipSettings key present',     "'flipSettings'" in html)
check('flipCustomSlots key present',  "'flipCustomSlots'" in html or 'CUSTOM_SLOTS_KEY' in html)
# They must be different keys
settings_key = re.search(r"'(flipSettings)'", html)
slots_key    = re.search(r"CUSTOM_SLOTS_KEY\s*=\s*'([^']+)'", html)
if settings_key and slots_key:
    check('localStorage keys do not collide', settings_key.group(1) != slots_key.group(1))

# ── 12. WARNINGS (non-critical) ───────────────────────────────────
# dlpColorMode not in saveSettings
save_block = html[html.find('function saveSettings'):html.find('function saveSettings')+500]
if 'dlpColorMode' not in save_block:
    warnings.append('WARN: dlpColorMode not persisted in saveSettings (resets to AQUA on reload)')
if 'dlpResonanceVal' not in save_block:
    warnings.append('WARN: dlpResonanceVal not persisted in saveSettings')
if 'dlpContrastVal' not in save_block:
    warnings.append('WARN: dlpContrastVal not persisted in saveSettings')

# touchmove cancel for hold timer
slot_block = html[html.find('pcs-slot'):html.find('pcs-slot')+2000]
if 'touchmove' not in html[html.find('_PCS_HOLD_MS'):html.find('_PCS_HOLD_MS')+1500]:
    warnings.append('WARN: touchmove not canceling hold timer on .pcs-slot (possible iOS scroll conflict)')

# CSS specificity conflict
if 'dlp-warm-mode.dolphin-mode.dlp-lgcy-mode' not in html:
    warnings.append('WARN: CSS specificity — body.dlp-warm-mode.dolphin-mode.dlp-lgcy-mode rule missing (WARM+LGCY theme conflict)')

# ── RESULTS ───────────────────────────────────────────────────────
print(f'\n{"="*60}')
print(f'AutoDebug Eval — FLIP CAM Evolution v1')
print(f'{"="*60}')
print(f'  File size:   {len(html):,} chars')
print(f'  Errors:      {len(errors)}')
print(f'  Warnings:    {len(warnings)}')
print(f'{"="*60}')

if errors:
    print('\nCRITICAL ERRORS:')
    for e in errors:
        print(f'  [ERR] {e}')
else:
    print('\n  All critical checks PASS.')

if warnings:
    print('\nWARNINGS (non-critical):')
    for w in warnings:
        print(f'  [WARN] {w}')

print(f'\n{"="*60}')
print('EVAL_PASS' if not errors else 'EVAL_FAIL')
sys.exit(0 if not errors else 1)
