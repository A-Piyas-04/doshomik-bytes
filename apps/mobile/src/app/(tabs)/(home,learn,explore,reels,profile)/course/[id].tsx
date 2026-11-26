import { useLocalSearchParams } from 'expo-router';
import { CourseScreen } from '@/features/learn/CourseScreen';

export default function CourseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CourseScreen id={id} />;
}
