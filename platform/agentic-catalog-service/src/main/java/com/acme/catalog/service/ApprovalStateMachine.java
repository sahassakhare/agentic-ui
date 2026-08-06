package com.acme.catalog.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Experience approval transitions (ports nextApprovalState). */
public final class ApprovalStateMachine {
    private ApprovalStateMachine() {}

    /** @return the next state, or 409 for an illegal transition. */
    public static String next(String from, String action) {
        String to = switch (action) {
            case "deprecate" -> "deprecated";
            case "submit" -> ("draft".equals(from) || "rejected".equals(from)) ? "review" : null;
            case "approve" -> "review".equals(from) ? "approved" : null;
            case "reject" -> "review".equals(from) ? "rejected" : null;
            case "revoke" -> "approved".equals(from) ? "draft" : null;
            default -> null;
        };
        if (to == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Illegal transition '" + action + "' from '" + from + "'");
        }
        return to;
    }
}
