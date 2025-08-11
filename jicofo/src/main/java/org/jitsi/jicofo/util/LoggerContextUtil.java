package org.jitsi.jicofo.util;

import org.jitsi.jicofo.conference.JitsiMeetConferenceImpl;
import org.jitsi.utils.logging2.Logger;
import org.jitsi.utils.logging2.LoggerImpl;

import java.lang.reflect.Field;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;

public class LoggerContextUtil {
    
    private static final org.slf4j.Logger logger = 
        org.slf4j.LoggerFactory.getLogger(LoggerContextUtil.class);
    
    /**
     * 获取Logger的Context内容
     * @param logger Logger实例
     * @return Context内容的Map，如果获取失败返回空Map
     */
    public static Map<String, Object> getLoggerContext(Logger logger) {
        if (logger == null) {
            return Collections.emptyMap();
        }
        
        if (logger instanceof LoggerImpl) {
            try {
                // 通过反射获取logContext.context字段
                Object o = ReflectionUtils.getNestedField(logger,"logContext.context");

                Map<String, Object> context = (Map<String, Object>) o;
                
                // 返回副本以避免外部修改
                return context != null ? new HashMap<>(context) : Collections.emptyMap();
                
            } catch (NoSuchFieldException e) {
                logger.warn("LoggerImpl does not have 'logContext.context' field", e);
            } catch (IllegalAccessException e) {
                logger.warn("Cannot access 'logContext.context' field in LoggerImpl", e);
            } catch (ClassCastException e) {
                logger.warn("Context field is not a Map<String, Object>", e);
            } catch (Exception e) {
                logger.warn("Unexpected error while accessing logger context", e);
            }
        }
        
        return Collections.emptyMap();
    }
    
    /**
     * 获取Logger Context中的特定值
     * @param logger Logger实例
     * @param key 要获取的key
     * @return 对应的值，如果不存在返回null
     */
    public static Object getContextValue(Logger logger, String key) {
        Map<String, Object> context = getLoggerContext(logger);
        return context.get(key);
    }
    
    /**
     * 获取Logger Context中的字符串值
     * @param logger Logger实例
     * @param key 要获取的key
     * @return 字符串值，如果不存在或不是字符串返回null
     */
    public static String getContextString(Logger logger, String key) {
        Object value = getContextValue(logger, key);
        return value instanceof String ? (String) value : null;
    }
    
    /**
     * 检查Logger Context是否包含指定的key
     * @param logger Logger实例
     * @param key 要检查的key
     * @return 如果包含返回true，否则返回false
     */
    public static boolean hasContextKey(Logger logger, String key) {
        Map<String, Object> context = getLoggerContext(logger);
        return context.containsKey(key);
    }
    
    /**
     * 打印Logger的Context内容（用于调试）
     * @param logger Logger实例
     * @param loggerName Logger名称（用于日志输出）
     */
    public static void printLoggerContext(Logger logger, String loggerName) {
        Map<String, Object> context = getLoggerContext(logger);
        
        if (context.isEmpty()) {
            System.out.println("Logger [" + loggerName + "] has no context");
        } else {
            System.out.println("Logger [" + loggerName + "] Context:");
            context.forEach((key, value) -> 
                System.out.println("  " + key + ": " + value)
            );
        }
    }
    
    /**
     * 将Logger Context转换为JSON字符串
     * @param logger Logger实例
     * @return JSON格式的字符串
     */
    public static String contextToJson(Logger logger) {
        Map<String, Object> context = getLoggerContext(logger);
        
        if (context.isEmpty()) {
            return "{}";
        }
        
        StringBuilder json = new StringBuilder("{");
        boolean first = true;
        
        for (Map.Entry<String, Object> entry : context.entrySet()) {
            if (!first) {
                json.append(",");
            }
            first = false;
            
            json.append("\"").append(escapeJson(entry.getKey())).append("\":");
            
            Object value = entry.getValue();
            if (value == null) {
                json.append("null");
            } else if (value instanceof String) {
                json.append("\"").append(escapeJson(value.toString())).append("\"");
            } else if (value instanceof Number || value instanceof Boolean) {
                json.append(value.toString());
            } else {
                json.append("\"").append(escapeJson(value.toString())).append("\"");
            }
        }
        
        json.append("}");
        return json.toString();
    }
    
    /**
     * 转义JSON字符串中的特殊字符
     */
    private static String escapeJson(String str) {
        if (str == null) {
            return "";
        }
        
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }

    public static void main(String[] args) {
        Logger logger = new LoggerImpl(JitsiMeetConferenceImpl.class.getName(), Level.INFO);
//        logger.addContext("meet_id","1213123");
        printLoggerContext(logger,"test");
        Map<String, Object> map = getLoggerContext(logger);
        System.out.println(map);
    }
}