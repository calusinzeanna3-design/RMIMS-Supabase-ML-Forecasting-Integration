// scratch/verify_user_settings.js
import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve('RMIMS/user/settings.html');
const jsPath = path.resolve('RMIMS/js/user-settings.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

console.log("1. Verifying Two-Panel Workspace Layout in user/settings.html...");
if (!htmlContent.includes('class="settings-workspace-layout"') || 
    !htmlContent.includes('class="settings-nav-panel"') || 
    !htmlContent.includes('class="settings-detail-panel"')) {
    console.error("FAILED: Missing two-panel workspace layout in user/settings.html");
    process.exit(1);
}
console.log("PASS: Two-panel workspace layout verified!");

console.log("2. Verifying the 6 User Compiler Views...");
const expectedViews = [
    'view-profile',
    'view-security',
    'view-sessions',
    'view-data',
    'view-system',
    'view-danger'
];
expectedViews.forEach(viewId => {
    if (!htmlContent.includes(`id="${viewId}"`)) {
        console.error(`FAILED: Missing view section #${viewId} in user/settings.html`);
        process.exit(1);
    }
});
console.log("PASS: All 6 User Views verified!");

console.log("3. Verifying Left Nav Compiler Items...");
const expectedNavKeys = ['profile', 'security', 'sessions', 'data', 'system', 'danger'];
expectedNavKeys.forEach(key => {
    if (!htmlContent.includes(`data-nav="${key}"`)) {
        console.error(`FAILED: Missing nav item for data-nav="${key}" in user/settings.html`);
        process.exit(1);
    }
});
console.log("PASS: All 6 Navigation items verified!");

console.log("4. Checking Protected Role presentation...");
if (htmlContent.includes('value="Administrator"') || jsContent.includes('role === "admin" &&')) {
    console.error("FAILED: User Settings incorrectly contains Administrator role text!");
    process.exit(1);
}
if (!htmlContent.includes('Staff Member')) {
    console.error("FAILED: User Settings does not display Staff Member role!");
    process.exit(1);
}
console.log("PASS: Protected Staff Member role verified!");

console.log("5. Checking Profile photo and interactive elements...");
const expectedElements = [
    'profileAvatarPreview',
    'profilePhotoInput',
    'uploadProfilePhotoBtn',
    'removeProfilePhotoBtn',
    'editProfileForm',
    'directChangePasswordForm',
    'signOutOthersBtn',
    'createBackupBtn',
    'openRestoreBtn',
    'openDeleteAccountBtn',
    'deleteAccountModal'
];
expectedElements.forEach(id => {
    if (!htmlContent.includes(`id="${id}"`)) {
        console.error(`FAILED: Missing element #${id} in user/settings.html`);
        process.exit(1);
    }
});
console.log("PASS: All interactive elements verified!");

console.log("ALL USER SETTINGS VERIFICATIONS PASSED!");
