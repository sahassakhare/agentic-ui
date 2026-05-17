{{/* Common labels */}}
{{- define "agentic-platform.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Selector labels for one component */}}
{{- define "agentic-platform.componentLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "agentic-platform.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (printf "%s-%s" .Release.Name .Chart.Name) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Resolved DATABASE_URL for the catalog. external takes precedence;
     otherwise build one from bundled-pg credentials. */}}
{{- define "agentic-platform.databaseUrl" -}}
{{- if .Values.database.external.enabled -}}
{{- if .Values.database.external.connectionString -}}
{{ .Values.database.external.connectionString }}
{{- else -}}
postgres://{{ .Values.database.external.username }}:$(POSTGRES_PASSWORD)@{{ .Values.database.external.host }}:{{ .Values.database.external.port }}/{{ .Values.database.external.database }}
{{- end -}}
{{- else if .Values.database.bundled.enabled -}}
postgres://{{ .Values.database.bundled.auth.username }}:{{ .Values.database.bundled.auth.password }}@{{ .Release.Name }}-postgres:5432/{{ .Values.database.bundled.auth.database }}
{{- else -}}
{{ fail "Either database.external or database.bundled must be enabled" }}
{{- end -}}
{{- end -}}

{{/* Catalog backend URL the ops-console nginx proxy points at. */}}
{{- define "agentic-platform.catalogBackend" -}}
{{- if .Values.opsConsole.catalogBackend -}}
{{ .Values.opsConsole.catalogBackend }}
{{- else -}}
http://{{ .Release.Name }}-catalog-server:{{ .Values.catalogServer.service.port }}
{{- end -}}
{{- end -}}

{{/* Image reference helper */}}
{{- define "agentic-platform.image" -}}
{{- printf "%s/%s:%s" $.Values.image.registry .repo .tag -}}
{{- end -}}
