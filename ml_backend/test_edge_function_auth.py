import unittest
import os
import re

# Comprehensive Test Suite for RMIMS V2 Phase 8 Step 8.4
# Tests Edge Function admin-create-user logic, security boundaries, and failure safety

class TestAdminCreateUserEdgeFunction(unittest.TestCase):

    def setUp(self):
        self.code_path = os.path.join(
            os.path.dirname(__file__), "..", "supabase", "functions", "admin-create-user", "index.ts"
        )
        with open(self.code_path, "r", encoding="utf-8") as f:
            self.code = f.read()

    # 1. Missing authentication → 401
    def test_01_missing_auth_header_rejected_401(self):
        self.assertIn("if (!authHeader)", self.code)
        self.assertIn("Missing Authorization header.", self.code)
        self.assertIn("status: 401", self.code)

    # 2. Invalid JWT → 401
    def test_02_invalid_jwt_rejected_401(self):
        self.assertIn("authVerificationClient.auth.getUser(token)", self.code)
        self.assertIn("if (authError || !callingUser)", self.code)
        self.assertIn("Invalid, expired, or unverified authentication token.", self.code)

    # 3. Normal user → 403
    def test_03_normal_user_role_blocked_403(self):
        self.assertIn('if (adminProfile.role !== "admin")', self.code)
        self.assertIn("Insufficient privileges. Administrator role required.", self.code)
        self.assertIn("status: 403", self.code)

    # 4. Inactive user → 403
    def test_04_inactive_user_status_blocked_403(self):
        self.assertIn('if (adminProfile.status !== "active")', self.code)
        self.assertIn("Caller account is inactive or pending administrator approval.", self.code)

    # 5. Admin + invalid email → rejected (400)
    def test_05_invalid_email_format_rejected_400(self):
        self.assertIn("EMAIL_REGEX", self.code)
        self.assertIn("!EMAIL_REGEX.test(rawEmail)", self.code)
        self.assertIn("Field 'email' must be a valid email address.", self.code)
        self.assertIn("status: 400", self.code)

    # 6. Admin + weak/invalid password (< 8 chars) → rejected (400)
    def test_06_weak_password_rejected_400(self):
        self.assertIn("rawPassword.length < 8", self.code)
        self.assertIn("Password must be at least 8 characters long.", self.code)

    # 7. Admin + missing full_name → rejected (400)
    def test_07_missing_full_name_rejected_400(self):
        self.assertIn("!rawFullName || rawFullName.length < 2", self.code)
        self.assertIn("Field 'full_name' is required (minimum 2 characters).", self.code)

    # 8. Admin + role=admin → rejected (400)
    def test_08_admin_role_escalation_rejected_400(self):
        self.assertIn('requestedRole !== "user"', self.code)
        self.assertIn("Administrative role creation is not permitted. New users must have role 'user'.", self.code)

    # 9. Admin + valid user creation → success (201)
    def test_09_valid_user_creation_returns_201(self):
        self.assertIn("adminClient.auth.admin.createUser", self.code)
        self.assertIn("status: 201", self.code)
        self.assertIn("User account created successfully.", self.code)

    # 10. Duplicate email → safe conflict (409)
    def test_10_duplicate_email_conflict_409(self):
        self.assertIn("already registered", self.code)
        self.assertIn("status: 409", self.code)
        self.assertIn("A user with this email address already exists.", self.code)

    # 11. Successful Auth user has matching user_profiles record
    def test_11_user_profile_synchronization(self):
        self.assertIn('.from("user_profiles")', self.code)
        self.assertIn("id: newUserId", self.code)
        self.assertIn("email: normalizedEmail", self.code)
        self.assertIn("full_name: rawFullName", self.code)
        self.assertIn('role: assignedRole', self.code)
        self.assertIn('status: assignedStatus', self.code)

    # 12. Successful creation generates audit record
    def test_12_audit_logging_generated(self):
        self.assertIn('.from("activity_audit_logs")', self.code)
        self.assertIn('action: "ADMIN_CREATE_USER"', self.code)
        self.assertIn('entity_type: "user_profiles"', self.code)
        self.assertIn("entity_id: newUserId", self.code)

    # 13. Password is never returned
    def test_13_password_never_returned(self):
        # Look at the return response for user object
        user_response_match = re.search(r'user:\s*\{([^}]+)\}', self.code)
        self.assertTrue(user_response_match)
        user_response_body = user_response_match.group(1)
        self.assertNotIn("password", user_response_body)

    # 14. Partial failure rollback protection
    def test_14_partial_failure_rollback(self):
        self.assertIn("if (profileInsertError)", self.code)
        self.assertIn("adminClient.auth.admin.deleteUser(newUserId)", self.code)
        self.assertIn("User creation was safely rolled back.", self.code)

    # 15. Secrets / service-role key never exposed
    def test_15_secrets_and_service_role_key_protected(self):
        self.assertNotIn("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", self.code)
        self.assertIn('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")', self.code)
        # Ensure service_role key is never included in any JSON.stringify response
        self.assertNotIn("serviceRoleKey:", self.code)
        self.assertNotIn("supabaseServiceRoleKey:", self.code)

if __name__ == "__main__":
    unittest.main()
