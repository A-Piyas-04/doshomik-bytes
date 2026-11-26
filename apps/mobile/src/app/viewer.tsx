import { useLocalSearchParams } from 'expo-router';
import { ImageViewer } from '@/features/viewer/ImageViewer';

export default function ViewerRoute() {
  const { url } = useLocalSearchParams<{ url: string }>();
  return <ImageViewer url={url} />;
}
