import { memo, PropsWithChildren, HTMLAttributes, forwardRef, ReactElement } from 'react';
import { Button, Container, Box, Text, Card, Heading, Grid, Separator } from "@radix-ui/themes";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { cn } from './lib/utils';
import { type NodeProps, Handle, Position, Node } from "@xyflow/react";
import { ActivityIcon } from 'lucide-react';
import { Label } from './components/ui/label';

export const Flow = memo((props: NodeProps) => {
  const { data } = props;
  const { title, description, footer, action, content } = data;
  return (
    <>
      {title}
      <Card
        id={`flow-node-${props.id}`}
        className={cn(
          "w-[250px]"
        )}
      >
        <CardContent>
          <Grid columns='3' gap="0" width="auto">
            <ActivityIcon height='40px' width='40px'/>
            <Separator orientation='vertical' size='3'/>
            {content}
          </Grid>
        </CardContent>
        <CardFooter>
          {footer}
          <CardAction>
            {action}
          </CardAction>
        </CardFooter>
      </Card>
      <Label style={{ left:'10px', top:'10px' }} size='1' htmlFor={`flow-node-${props.id}`}>{description}</Label>
      <Handle type="target" position={Position.Left} style={{ left: '-2px' }}/>
      <Handle type="source" position={Position.Right} style={{ right: '-2px' }}/>
    </>
  );
});

Flow.displayName = "FlowNodes";
