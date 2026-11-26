import { useLocalSearchParams } from 'expo-router';
import { LessonScreen } from '@/features/learn/LessonScreen';

export default function LessonRoute() {
  const { id, course, step } = useLocalSearchParams<{ id: string; course?: string; step?: string }>();
  return <LessonScreen key={`${id}-${step ?? ''}`} id={id} courseId={course} step={step ? Number(step) : undefined} />;
}
