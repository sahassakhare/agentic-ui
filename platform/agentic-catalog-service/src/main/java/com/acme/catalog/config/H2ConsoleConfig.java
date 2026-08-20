package com.acme.catalog.config;

import jakarta.servlet.http.HttpServlet;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Serve the H2 web console at {@code /h2-console}. Spring Boot 4 no longer
 * auto-configures the console from {@code spring.h2.console.enabled}, so we map
 * the H2 servlet explicitly. Guarded on that property, so it is absent in the
 * postgres/oracle profiles. {@code SecurityConfig} already permits
 * {@code /h2-console/**} and disables frame options for it.
 *
 * <p>H2 is a runtime-scope dependency, so the servlet class isn't on the compile
 * classpath — instantiate it reflectively (it resolves at runtime, where H2 is
 * present in the local/dev profile).
 */
@Configuration
@ConditionalOnProperty(name = "spring.h2.console.enabled", havingValue = "true")
public class H2ConsoleConfig {

  @Bean
  ServletRegistrationBean<HttpServlet> h2ConsoleServlet() throws ReflectiveOperationException {
    HttpServlet servlet = (HttpServlet) Class.forName("org.h2.server.web.JakartaWebServlet")
        .getDeclaredConstructor().newInstance();
    ServletRegistrationBean<HttpServlet> reg = new ServletRegistrationBean<>(servlet, "/h2-console/*");
    reg.addInitParameter("webAllowOthers", "true");
    reg.addInitParameter("trace", "false");
    reg.setName("h2-console");
    return reg;
  }
}
