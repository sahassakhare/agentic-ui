package com.acme.catalog.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * Translates the Hibernate optimistic-lock failure (the atomic backstop for the
 * same-version race that slips past the explicit If-Match check) into a
 * 412 Precondition Failed the Studio surfaces as "changed elsewhere — reload".
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, Object>> onOptimisticLock(ObjectOptimisticLockingFailureException e) {
        return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED)
                .body(Map.of("code", "stale_version",
                        "message", "This capability was changed by someone else — reload and retry."));
    }
}
