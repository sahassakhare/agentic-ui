package com.acme.catalog.support;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Thin JSON helper around the shared Jackson (3) {@link ObjectMapper}. JSON
 * columns are stored as text (portable across H2/Postgres/Oracle); this converts
 * between the stored string and {@link JsonNode}/lists so DTOs expose real JSON.
 */
@Component
public class Json {
    private final ObjectMapper mapper;

    public Json(ObjectMapper mapper) { this.mapper = mapper; }

    /** Serialize any value to a JSON string (null → "null"). */
    public String write(Object value) {
        return value == null ? "null" : mapper.writeValueAsString(value);
    }

    /** Parse stored JSON text to a node ("" / null → an empty object). */
    public JsonNode read(String text) {
        return (text == null || text.isBlank()) ? mapper.createObjectNode() : mapper.readTree(text);
    }

    /** Parse a stored JSON array of strings (null/blank → empty list). */
    public List<String> readStringList(String text) {
        try {
            if (text == null || text.isBlank()) return List.of();
            return mapper.readerForListOf(String.class).readValue(text);
        } catch (Exception e) { return List.of(); }
    }

    public ObjectMapper mapper() { return mapper; }
}
