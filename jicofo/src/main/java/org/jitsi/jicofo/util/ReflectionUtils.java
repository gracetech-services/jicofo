package org.jitsi.jicofo.util;


import java.lang.reflect.Field;

public class ReflectionUtils {
    /**
     * 通过反射获取嵌套对象字段值
     * @param obj 目标对象
     * @param fieldPath 字段路径，如"parent.child.value"
     * @return 字段值
     */
    public static Object getNestedField(Object obj, String fieldPath) throws Exception {
        String[] fields = fieldPath.split("\\.");
        Object current = obj;

        for (String fieldName : fields) {
            Field field = getField(current.getClass(), fieldName);
            field.setAccessible(true);
            current = field.get(current);
            if (current == null) return null;
        }
        return current;
    }

    private static Field getField(Class<?> clazz, String fieldName) throws NoSuchFieldException {
        try {
            return clazz.getDeclaredField(fieldName);
        } catch (NoSuchFieldException e) {
            Class<?> superClass = clazz.getSuperclass();
            if (superClass != null) {
                return getField(superClass, fieldName);
            }
            throw e;
        }
    }
}
