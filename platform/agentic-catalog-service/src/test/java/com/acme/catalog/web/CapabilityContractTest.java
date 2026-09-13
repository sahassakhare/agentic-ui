package com.acme.catalog.web;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Contract tests for the capability control-plane — the governance behaviour the
 * Studio + Hub depend on: create/read, the approval state machine, optimistic
 * concurrency (If-Match → 412), and per-tenant data isolation. Runs the real HTTP
 * stack on a random port against in-memory H2, auth disabled (synthetic
 * platform-admin), seed off. Uses the JDK HTTP client + tiny string extractors,
 * so it's independent of the Boot test-slice layout and the Jackson 2/3 split.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class CapabilityContractTest {

    @LocalServerPort int port;
    private final HttpClient http = HttpClient.newHttpClient();

    private String url(String tenant, String suffix) {
        return "http://localhost:" + port + "/v1/catalogs/" + tenant + "/capabilities" + suffix;
    }

    private HttpResponse<String> send(String method, String uri, String ifMatch, String body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(uri));
        if (body != null) b.header("Content-Type", "application/json");
        if (ifMatch != null) b.header("If-Match", ifMatch);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> createForm(String tenant, String name) throws Exception {
        return send("POST", url(tenant, ""), null,
                "{\"kind\":\"form\",\"name\":\"" + name + "\",\"body\":{\"schema\":{\"fields\":[]}}}");
    }

    /** Value of a JSON string field: "field":"value". */
    private static String str(String json, String field) {
        String key = "\"" + field + "\":\"";
        int i = json.indexOf(key);
        if (i < 0) return null;
        i += key.length();
        return json.substring(i, json.indexOf('"', i));
    }

    /** Value of a JSON numeric field: "field":123. */
    private static int intVal(String json, String field) {
        String key = "\"" + field + "\":";
        int i = json.indexOf(key) + key.length();
        int j = i;
        while (j < json.length() && (Character.isDigit(json.charAt(j)) || json.charAt(j) == '-')) j++;
        return Integer.parseInt(json.substring(i, j).trim());
    }

    private boolean listHasName(String tenant, String name) throws Exception {
        return send("GET", url(tenant, "?kind=form"), null, null).body().contains("\"name\":\"" + name + "\"");
    }

    @Test
    void create_defaults_to_draft_and_version_zero_with_an_etag() throws Exception {
        HttpResponse<String> r = send("POST", url("acme", ""), null,
                "{\"kind\":\"form\",\"name\":\"c-create\",\"body\":{}}");
        assertEquals(201, r.statusCode());
        assertNotNull(r.headers().firstValue("ETag").orElse(null), "ETag header");
        assertEquals("form", str(r.body(), "kind"));
        assertEquals("draft", str(r.body(), "approvalState"));
        assertEquals(0, intVal(r.body(), "version"));
    }

    @Test
    void created_capability_is_readable_and_listed_by_kind() throws Exception {
        String id = str(createForm("acme", "c-read").body(), "id");
        HttpResponse<String> get = send("GET", url("acme", "/" + id), null, null);
        assertEquals(200, get.statusCode());
        assertEquals("c-read", str(get.body(), "name"));
        assertTrue(listHasName("acme", "c-read"), "listed by kind");
    }

    @Test
    void update_with_current_if_match_bumps_the_version() throws Exception {
        HttpResponse<String> created = createForm("acme", "c-update");
        String id = str(created.body(), "id");
        String etag = created.headers().firstValue("ETag").orElseThrow();
        HttpResponse<String> upd = send("PATCH", url("acme", "/" + id), etag,
                "{\"body\":{\"schema\":{\"fields\":[{\"name\":\"x\",\"type\":\"text\"}]}}}");
        assertEquals(200, upd.statusCode());
        assertEquals(1, intVal(upd.body(), "version"));
    }

    @Test
    void stale_if_match_is_rejected_with_412() throws Exception {
        HttpResponse<String> created = createForm("acme", "c-concurrency");
        String id = str(created.body(), "id");
        String staleEtag = created.headers().firstValue("ETag").orElseThrow(); // version 0
        assertEquals(200, send("PATCH", url("acme", "/" + id), staleEtag, "{\"body\":{\"v\":1}}").statusCode());
        // Re-using the version-0 etag after the row moved to v1 is a stale write.
        assertEquals(412, send("PATCH", url("acme", "/" + id), staleEtag, "{\"body\":{\"v\":2}}").statusCode());
    }

    @Test
    void approval_state_machine_walks_draft_to_review_to_approved() throws Exception {
        String id = str(createForm("acme", "c-govern").body(), "id");
        HttpResponse<String> submit = send("POST", url("acme", "/" + id + "/transition"), null, "{\"action\":\"submit\"}");
        assertEquals(200, submit.statusCode());
        assertEquals("review", str(submit.body(), "approvalState"));
        HttpResponse<String> approve = send("POST", url("acme", "/" + id + "/transition"), null, "{\"action\":\"approve\"}");
        assertEquals(200, approve.statusCode());
        assertEquals("approved", str(approve.body(), "approvalState"));
    }

    @Test
    void delete_soft_removes_from_the_default_list() throws Exception {
        String id = str(createForm("acme", "c-delete").body(), "id");
        assertEquals(204, send("DELETE", url("acme", "/" + id), null, null).statusCode());
        assertFalse(listHasName("acme", "c-delete"), "gone from default list");
    }

    @Test
    void capabilities_are_isolated_per_tenant() throws Exception {
        createForm("iso-alpha", "tenant-scoped");
        assertFalse(listHasName("iso-beta", "tenant-scoped"), "another tenant cannot see it");
    }
}
