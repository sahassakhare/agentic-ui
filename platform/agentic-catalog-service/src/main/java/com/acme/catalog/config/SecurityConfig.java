package com.acme.catalog.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Auth: an OAuth2 resource server validating JWTs against the OIDC issuer, with
 * per-verb RBAC (writes need a writer role; reads + /plan open to any member).
 * The `disabled` mode (local) permits all and relies on a synthetic admin actor —
 * equivalent to the Node AUTH_MODE=disabled. The JWT decoder is only built in
 * oidc mode, so local dev needs no IdP at startup. Embed routes are permitAll and
 * self-authenticate by embed key in the controller.
 */
@Configuration
@EnableConfigurationProperties(CatalogProperties.class)
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, CatalogProperties props) throws Exception {
        http.csrf(c -> c.disable())
            .cors(Customizer.withDefaults())
            .headers(h -> h.frameOptions(f -> f.disable()))   // H2 console
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));

        http.authorizeHttpRequests(a -> {
            a.requestMatchers("/health", "/readyz", "/v1/embed/**", "/h2-console/**", "/actuator/**",
                              "/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll();
            if (props.authDisabled()) {
                a.anyRequest().permitAll();
            } else {
                String[] writers = props.getAuth().writerRoleList().toArray(String[]::new);
                a.requestMatchers(HttpMethod.POST, "/v1/catalogs/*/experiences/*/plan").authenticated();
                a.requestMatchers(HttpMethod.GET, "/v1/**").authenticated();
                a.requestMatchers(HttpMethod.POST, "/v1/catalogs/**").hasAnyAuthority(writers);
                a.requestMatchers(HttpMethod.PATCH, "/v1/catalogs/**").hasAnyAuthority(writers);
                a.requestMatchers(HttpMethod.DELETE, "/v1/catalogs/**").hasAnyAuthority(writers);
                a.anyRequest().authenticated();
            }
        });

        if (!props.authDisabled()) {
            http.oauth2ResourceServer(o -> o.jwt(j -> {
                j.decoder(jwtDecoder(props));
                j.jwtAuthenticationConverter(jwtConverter());
            }));
        }
        return http.build();
    }

    private JwtDecoder jwtDecoder(CatalogProperties props) {
        NimbusJwtDecoder decoder = (NimbusJwtDecoder) JwtDecoders.fromIssuerLocation(props.getAuth().issuer);
        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(props.getAuth().issuer);
        OAuth2TokenValidator<Jwt> audience = jwt -> jwt.getAudience() != null && jwt.getAudience().contains(props.getAuth().audience)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_audience", "Required audience missing", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(withIssuer, audience));
        return decoder;
    }

    private JwtAuthenticationConverter jwtConverter() {
        JwtGrantedAuthoritiesConverter roles = new JwtGrantedAuthoritiesConverter();
        roles.setAuthoritiesClaimName("roles");
        roles.setAuthorityPrefix("");
        JwtAuthenticationConverter conv = new JwtAuthenticationConverter();
        conv.setJwtGrantedAuthoritiesConverter(roles);
        return conv;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(CatalogProperties props) {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(props.getCors().originList());
        cfg.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }
}
