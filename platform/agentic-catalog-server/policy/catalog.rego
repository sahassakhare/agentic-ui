package catalog

# Fine-grained authorization the catalog consults on every governance-relevant
# WRITE (layered on top of per-verb RBAC). Demonstrates policy that RBAC alone
# cannot express: an `editor` is a writer, but may NOT modify policy bundles —
# those are reserved for platform-admin / compliance.

default allow := false

# Reads are always allowed (the enforcement middleware only calls OPA for
# writes, but keep the policy safe regardless).
allow if input.method == "GET"

# platform-admin may perform any action.
allow if "platform-admin" in input.principal.roles

# Editors may write anything EXCEPT policy bundles.
allow if {
	input.method != "GET"
	"editor" in input.principal.roles
	not is_policy_resource
}

is_policy_resource if contains(input.path, "/policy/")
