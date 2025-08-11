package org.jitsi.jicofo.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.TransactionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.jetbrains.annotations.NotNull;
import org.jitsi.jicofo.db.mapper.ConferenceMapper;
import org.jitsi.jicofo.db.mapper.ParticipantMapper;
import org.jitsi.utils.logging2.LoggerImpl;
import org.jitsi.utils.logging2.Logger;

import java.io.InputStream;
import java.sql.Connection;
import java.sql.SQLException;

import static org.jitsi.jicofo.DbConfig.config;

public class DatabaseManager {
    @NotNull
    private final Logger logger;

    private static DatabaseManager instance;
    private HikariDataSource dataSource;
    private SqlSessionFactory sqlSessionFactory;

    private DatabaseManager() {
        logger = new LoggerImpl(DatabaseManager.class.getName());
        initializeDataSource();
        initializeMyBatis();
    }

    public static synchronized DatabaseManager getInstance() {
        if (instance == null) {
            instance = new DatabaseManager();
        }
        return instance;
    }

    private void initializeDataSource() {
        try {
            String jdbcUrl = config.getDbUrl();
            String username = config.getUsrName();
            String password = config.getPassword();
            int maximumPoolSize = config.getMaxPoolSize();
            int minimumIdle = config.getMinIdle();
            long connectionTimeout = config.getConnectionTimeout();
            long idleTimeout = config.getIdleTimeout();
            long maxLifetime = config.getMaxLifetime();

            HikariConfig hikariConfig = new HikariConfig();
            hikariConfig.setJdbcUrl(jdbcUrl);
            hikariConfig.setUsername(username);
            hikariConfig.setPassword(password);
            hikariConfig.setMaximumPoolSize(maximumPoolSize);
            hikariConfig.setMinimumIdle(minimumIdle);
            hikariConfig.setConnectionTimeout(connectionTimeout);
            hikariConfig.setIdleTimeout(idleTimeout);
            hikariConfig.setMaxLifetime(maxLifetime);

            // MySQL特定优化配置
            hikariConfig.addDataSourceProperty("cachePrepStmts", "true");
            hikariConfig.addDataSourceProperty("prepStmtCacheSize", "250");
            hikariConfig.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
            hikariConfig.addDataSourceProperty("useServerPrepStmts", "true");
            hikariConfig.addDataSourceProperty("rewriteBatchedStatements", "true");
            hikariConfig.addDataSourceProperty("useLocalSessionState", "true");
            hikariConfig.addDataSourceProperty("elideSetAutoCommits", "true");

            dataSource = new HikariDataSource(hikariConfig);
            logger.info("Database connection pool initialized successfully with URL: " + jdbcUrl);
        } catch (Exception e) {
            logger.error("Failed to initialize database connection pool", e);
            throw new RuntimeException("Database initialization failed", e);
        }
    }

    private void initializeMyBatis() {
        try {
            InputStream inputStream = getClass().getClassLoader().getResourceAsStream("mybatis-config.xml");
            sqlSessionFactory = new SqlSessionFactoryBuilder().build(inputStream);
            // 3. 创建事务工厂
            TransactionFactory transactionFactory = new JdbcTransactionFactory();
            // 4. 创建 MyBatis 环境
            Environment environment = new Environment(
                    "development",
                    transactionFactory,
                    dataSource
            );
            Configuration configuration = sqlSessionFactory.getConfiguration();
            configuration.setEnvironment(environment);

            logger.info("MyBatis initialized successfully");
        } catch (Exception e) {
            logger.error("Failed to initialize MyBatis", e);
            throw new RuntimeException("MyBatis initialization failed", e);
        }
    }

    public Connection getConnection() throws SQLException {
        if (dataSource == null) {
            throw new SQLException("Database connection pool not initialized");
        }
        return dataSource.getConnection();
    }

    /**
     * 获取SqlSession
     */
    public SqlSession getSqlSession() {
        return sqlSessionFactory.openSession();
    }

    /**
     * 获取SqlSession（自动提交）
     */
    public SqlSession getSqlSession(boolean autoCommit) {
        return sqlSessionFactory.openSession(autoCommit);
    }

    /**
     * 执行会议相关操作
     */
    public <T> T executeConferenceOperation(ConferenceOperation<T> operation) {
        try (SqlSession session = getSqlSession(true)) {
            ConferenceMapper mapper = session.getMapper(ConferenceMapper.class);
            return operation.execute(mapper);
        } catch (Exception e) {
            logger.error("Failed to execute conference operation", e);
            throw new RuntimeException("Conference operation failed", e);
        }
    }

    /**
     * 执行参会人员相关操作
     */
    public <T> T executeParticipantOperation(ParticipantOperation<T> operation) {
        try (SqlSession session = getSqlSession(true)) {
            ParticipantMapper mapper = session.getMapper(ParticipantMapper.class);
            return operation.execute(mapper);
        } catch (Exception e) {
            logger.error("Failed to execute participant operation", e);
            throw new RuntimeException("Participant operation failed", e);
        }
    }

    /**
     * 执行事务操作
     */
    public <T> T executeTransaction(TransactionOperation<T> operation) {
        try (SqlSession session = getSqlSession(false)) {
            try {
                ConferenceMapper conferenceMapper = session.getMapper(ConferenceMapper.class);
                ParticipantMapper participantMapper = session.getMapper(ParticipantMapper.class);
                
                T result = operation.execute(conferenceMapper, participantMapper);
                session.commit();
                return result;
            } catch (Exception e) {
                session.rollback();
                throw e;
            }
        } catch (Exception e) {
            logger.error("Failed to execute transaction", e);
            throw new RuntimeException("Transaction failed", e);
        }
    }

    public void shutdown() {
        if (dataSource != null) {
            dataSource.close();
            logger.info("Database connection pool closed");
        }
    }

    public boolean testConnection() {
        try (Connection connection = getConnection()) {
            return connection.isValid(5);
        } catch (SQLException e) {
            logger.error("Database connection test failed", e);
            return false;
        }
    }

    // 保留原有的日志方法
    public void logUserOperation(String userId, String roomId, String meetingId, String operationType, String data) {
        String sql = "INSERT INTO jicofo_user_operations (user_id, room_id, meeting_id, operation_type, operation_data) VALUES (?, ?, ?, ?, ?)";
        try (Connection conn = dataSource.getConnection();
             java.sql.PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, userId);
            stmt.setString(2, roomId);
            stmt.setString(3, meetingId);
            stmt.setString(4, operationType);
            stmt.setString(5, data);
            int result = stmt.executeUpdate();
            if (result > 0) {
                logger.debug("Logged user operation:" + operationType + " for user " + userId + " in room " + roomId);
            }
        } catch (SQLException e) {
            logger.error("Failed to log user operation:" + operationType + " for user " + userId + " in room " + roomId, e);
        }
    }

    // 函数式接口
    @FunctionalInterface
    public interface ConferenceOperation<T> {
        T execute(ConferenceMapper mapper) throws Exception;
    }

    @FunctionalInterface
    public interface ParticipantOperation<T> {
        T execute(ParticipantMapper mapper) throws Exception;
    }

    @FunctionalInterface
    public interface TransactionOperation<T> {
        T execute(ConferenceMapper conferenceMapper, ParticipantMapper participantMapper) throws Exception;
    }
}
